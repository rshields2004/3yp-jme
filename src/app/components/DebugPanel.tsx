"use client";

import { useJModellerContext } from "../context/JModellerContext";
import { defaultExitConfig, defaultIntersectionConfig } from "../includes/defaults";
import { IntersectionConfig, JunctionLink } from "../includes/types";

export default function DebugPanel() {
    const {
        junction,
        setJunction,
        selectedExits,
        setSelectedExits,
        removeObject
    } = useJModellerContext();



    const updateIntersectionConfig = (objID: string, updater: (config: IntersectionConfig) => IntersectionConfig) => {
        setJunction(prev => ({
            ...prev,
            junctionObjects: prev.junctionObjects.map(obj => obj.id === objID && obj.type === "intersection" ? { ...obj, config: updater(obj.config as IntersectionConfig) } : obj),
        }));
    };


    const addNewIntersection = () => {
        if (junction.junctionObjects.filter(o => o.type === "intersection").length >= 10) {
            return;
        }
        setJunction(prev => ({
            ...prev,
            junctionObjects: [...prev.junctionObjects, { 
                id: crypto.randomUUID(),
                type: "intersection",
                config: defaultIntersectionConfig
             }]
        }));
    };

    const addNewLink = () => {
        if (selectedExits.length !== 2) {
            return;
        }

        const [a, b] = selectedExits;
        const exists = junction.junctionLinks.some(link =>
            (
                link.objectPair[0].junctionGroup === a.junctionGroup && link.objectPair[0].exitIndex === a.exitIndex &&
                link.objectPair[1].junctionGroup === b.junctionGroup && link.objectPair[1].exitIndex === b.exitIndex
            ) ||
            (
                link.objectPair[0].junctionGroup === b.junctionGroup && link.objectPair[0].exitIndex === b.exitIndex &&
                link.objectPair[1].junctionGroup === a.junctionGroup && link.objectPair[1].exitIndex === a.exitIndex
            )
        );

        if (exists) {
            return;
        }

        const newLink: JunctionLink = { id: crypto.randomUUID(), objectPair: [a, b] };
        setJunction(prev => ({ ...prev, junctionLinks: [...prev.junctionLinks, newLink] }));
        setSelectedExits([]);
    };

    const removeLink = (linkID: string) => {
        setJunction(prev => ({ ...prev, junctionLinks: prev.junctionLinks.filter(l => l.id !== linkID) }));
    };

    return (
        <>
            {/* Add Intersection */}
            <div style={{ position: "absolute", top: 10, right: 10, padding: 10, background: "rgba(0,0,0,0.7)", color: "white", borderRadius: 8, minWidth: 300 }}>
                <h2>Add Intersection</h2>
                <button onClick={addNewIntersection}>Add New</button>
            </div>

            {/* Links Panel */}
            <div style={{ position: "absolute", bottom: 10, right: 10, padding: 10, background: "rgba(0,0,0,0.7)", color: "white", borderRadius: 8, minWidth: 300 }}>
                <h2>Exit Links</h2>
                <button onClick={addNewLink} disabled={selectedExits.length !== 2}>Add Link</button>
                {junction.junctionLinks.map(link => (
                    <div key={link.id} style={{ marginBottom: 5 }}>
                        <p>Exit {link.objectPair[0].exitIndex} ↔ Exit {link.objectPair[1].exitIndex}</p>
                        <button onClick={() => removeLink(link.id)}>Remove</button>
                    </div>
                ))}
            </div>

            {/* Intersection Config Panel */}
            <div style={{ position: "absolute", top: 10, left: 10, padding: 10, background: "rgba(0,0,0,0.7)", color: "white", borderRadius: 8, minWidth: 300, maxHeight: "40vh", overflowY: "auto" }}>
                <h2>Intersections</h2>
                {junction.junctionObjects.filter(obj => obj.type === "intersection").map((obj, i) => {
                    const config = obj.config as IntersectionConfig;
                    return (
                        <div key={obj.id} style={{ marginBottom: "1rem" }}>
                            <h3>Intersection #{i}</h3>
                            <label># Exits:
                                <input type="number" min={2} value={config.numExits} onChange={e => updateIntersectionConfig(obj.id, cfg => ({ ...cfg, numExits: Number(e.target.value), exitConfig: Array.from({ length: Number(e.target.value) }, (_, j) => cfg.exitConfig[j] ?? defaultExitConfig) }))} />
                            </label>
                            <button onClick={() => removeObject(obj.id)}>Delete</button>

                            {config.exitConfig.map((exit, j) => (
                                <div key={j}>
                                    <h4>Exit {j}</h4>
                                    <label># Lanes:
                                        <input type="number" min={2} value={exit.laneCount} onChange={e => updateIntersectionConfig(obj.id, cfg => ({ ...cfg, exitConfig: cfg.exitConfig.map((ex, idx) => idx === j ? { ...ex, laneCount: Number(e.target.value) } : ex) }))} />
                                    </label>
                                    <label>Length:
                                        <input type="number" min={10} value={exit.exitLength} onChange={e => updateIntersectionConfig(obj.id, cfg => ({ ...cfg, exitConfig: cfg.exitConfig.map((ex, idx) => idx === j ? { ...ex, exitLength: Number(e.target.value) } : ex) }))} />
                                    </label>
                                </div>
                            ))}
                        </div>
                    );
                })}
            </div>
        </>
    );
};