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
                                        background: "rgba(9,9,11,0.93)",
                                        border: "1px solid rgba(161,161,170,0.15)",
                                        borderRadius: 8,
                                        padding: "8px 12px",
                                        fontFamily: "var(--font-mono), 'Courier New', monospace",
                                        whiteSpace: "nowrap",
                                        boxShadow: "0 4px 24px rgba(0,0,0,0.65)",
                                        minWidth: 150,
                                        backdropFilter: "blur(8px)",
                                    }}
                                >
                                    <div style={{
                                        fontSize: 11, fontWeight: 700, letterSpacing: "0.1em",
                                        color: "rgba(255,255,255,0.95)", textTransform: "uppercase",
                                        marginBottom: 6, paddingBottom: 5,
                                        borderBottom: "1px solid rgba(161,161,170,0.12)",
                                    }}>
                                        {js.type === "roundabout" ? "Roundabout" : "Intersection"} {junctionObject?.name}
                                    </div>
                                    {([
                                        ["Approaching", js.approaching],
                                        ["Waiting",     js.waiting],
                                        ["Inside",      js.inside],
                                        ["Exiting",     js.exiting],
                                        ["Entered",     js.entered],
                                        ["Exited",      js.exited],
                                    ] as [string, number][]).map(([label, value]) => (
                                        <div key={label} style={{
                                            display: "flex", justifyContent: "space-between",
                                            gap: 16, fontSize: 11,
                                            padding: "2px 0",
                                            borderBottom: "1px solid rgba(161,161,170,0.07)",
                                        }}>
                                            <span style={{ color: "rgba(225,225,230,0.85)" }}>{label}</span>
                                            <span style={{ color: "rgba(255,255,255,0.95)", fontVariantNumeric: "tabular-nums" }}>{value}</span>
                                        </div>
                                    ))}
                                    <div style={{
                                        display: "flex", justifyContent: "space-between",
                                        gap: 16, fontSize: 11, marginTop: 4,
                                    }}>
                                        <span style={{ color: "rgba(225,225,230,0.85)" }}>Avg Wait</span>
                                        <span style={{ color: "rgba(255,255,255,0.95)", fontVariantNumeric: "tabular-nums" }}>{js.avgWaitTime.toFixed(1)}s</span>
                                    </div>
                                    {js.state && (
                                        <div style={{
                                            marginTop: 5, paddingTop: 5,
                                            borderTop: "1px solid rgba(161,161,170,0.12)",
                                            fontSize: 11,
                                            display: "flex", justifyContent: "space-between", gap: 16,
                                        }}>
                                            <span style={{ color: "rgba(225,225,230,0.85)" }}>Signal</span>
                                            <span style={{ color: "rgba(255,255,255,0.95)", letterSpacing: "0.05em" }}>{js.state}</span>
                                        </div>
                                    )}
                                </div>
                            </Html>
                        </Billboard>
                    </group>
                );
            })}
        </>
    );
}