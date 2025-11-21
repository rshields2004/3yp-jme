"use client";

import { exit } from "process";
import { useJModellerContext } from "../context/JModellerContext";
import { defaultExitConfig, defaultIntersectionConfig } from "../includes/defaults";
import { ExitStructure, IntersectionConfig, JunctionLink } from "../includes/types";
import * as THREE from "three";

export default function DebugPanel() {
    const {
        junction,
        setJunction,
        selectedExits,
        setSelectedExits,
        removeObject,
        setBestRotation
    } = useJModellerContext();



     const handleNumExitsChange = (objID: string, value: number) => {
        setJunction(prev => ({
            ...prev,
            junctionObjects: prev.junctionObjects.map(obj =>
                obj.id === objID && obj.type === "intersection"
                    ? {
                        ...obj,
                        config: {
                            ...obj.config as IntersectionConfig,
                            numExits: value,
                            exitConfig: Array.from(
                                { length: value },
                                (_, j) => (obj.config as IntersectionConfig).exitConfig[j] ?? defaultExitConfig
                            )
                        }
                    }
                    : obj
            )
        }));
    };

    const handleLaneCountChange = (objID: string, exitIndex: number, value: number) => {
        setJunction(prev => ({
            ...prev,
            junctionObjects: prev.junctionObjects.map(obj =>
                obj.id === objID && obj.type === "intersection"
                    ? {
                        ...obj,
                        config: {
                            ...obj.config as IntersectionConfig,
                            exitConfig: (obj.config as IntersectionConfig).exitConfig.map((ex, idx) => {
                                if (idx === exitIndex) {
                                    const newLaneCount = value;
                                    let newNumLanesIn = ex.numLanesIn;

                                    // Ensure numLanesIn is within 1 .. newLaneCount - 1
                                    if (newNumLanesIn < 1 || newNumLanesIn >= newLaneCount) {
                                        newNumLanesIn = Math.floor(newLaneCount / 2);
                                    }

                                    return {
                                        ...ex,
                                        laneCount: newLaneCount,
                                        numLanesIn: newNumLanesIn
                                    };
                                }
                                return ex;
                            })
                        }
                    }
                    : obj
            )
        }));
    };

    const handleExitLengthChange = (objID: string, exitIndex: number, value: number) => {
        setJunction(prev => ({
            ...prev,
            junctionObjects: prev.junctionObjects.map(obj =>
                obj.id === objID && obj.type === "intersection"
                    ? {
                        ...obj,
                        config: {
                            ...obj.config as IntersectionConfig,
                            exitConfig: (obj.config as IntersectionConfig).exitConfig.map((ex, idx) =>
                                idx === exitIndex ? { ...ex, exitLength: value } : ex
                            )
                        }
                    }
                    : obj
            )
        }));
    };

    const handleNumLanesInChange = (objID: string, exitIndex: number, value: number) => {
        setJunction(prev => ({
            ...prev,
            junctionObjects: prev.junctionObjects.map(obj =>
                obj.id === objID && obj.type === "intersection"
                    ? {
                        ...obj,
                        config: {
                            ...obj.config as IntersectionConfig,
                            exitConfig: (obj.config as IntersectionConfig).exitConfig.map((ex, idx) =>
                                idx === exitIndex ? { ...ex, numLanesIn: value } : ex
                            )
                        }
                    }
                    : obj
            )
        }));
    };

    const addNewIntersection = () => {
        if (junction.junctionObjects.filter(o => o.type === "intersection").length >= 10) return;

        setJunction(prev => ({
            ...prev,
            junctionObjects: [
                ...prev.junctionObjects,
                { id: crypto.randomUUID(), type: "intersection", config: defaultIntersectionConfig }
            ]
        }));
    };

    const addNewLink = () => {
        if (selectedExits.length !== 2) return;

        const [a, b] = selectedExits;
        const exists = junction.junctionLinks.some(link =>
            (
                link.objectPair[0].structureID === a.structureID && link.objectPair[0].exitIndex === a.exitIndex &&
                link.objectPair[1].structureID === b.structureID && link.objectPair[1].exitIndex === b.exitIndex
            ) ||
            (
                link.objectPair[0].structureID === b.structureID && link.objectPair[0].exitIndex === b.exitIndex &&
                link.objectPair[1].structureID === a.structureID && link.objectPair[1].exitIndex === a.exitIndex
            )
        );
        if (exists) {
            return;
        }
        const newLink: JunctionLink = { id: crypto.randomUUID(), objectPair: [a, b] };

        const exitA = newLink.objectPair[0];
        const exitB = newLink.objectPair[1];

        // Get the config of each junction
        const junctionoA = junction.junctionObjects.find(jo => jo.id === exitA.structureID);
        const junctionoB = junction.junctionObjects.find(jo => jo.id === exitB.structureID);

        // Get the exit configs
        const exitAConfig = junctionoA?.config;
        const exitBConfig = junctionoB?.config;

        if (exitAConfig && exitBConfig) {
            const laneCountA = exitAConfig.exitConfig[exitA.exitIndex].laneCount;
            const laneCountB = exitBConfig.exitConfig[exitB.exitIndex].laneCount;

            if (laneCountA === laneCountB) {
                setJunction(prev => ({ ...prev, junctionLinks: [...prev.junctionLinks, newLink] }));
                setSelectedExits([]);
            } 
            else {
                alert("Cannot link exits with different number of lanes...yet!");
            }
        }
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
                <h2>Intersection</h2>
                {junction.junctionObjects.filter(obj => obj.type === "intersection").map((obj, i) => {
                    const config = obj.config as IntersectionConfig;
                    return (
                        <div key={obj.id} style={{ marginBottom: "1rem" }}>
                            <h3>Intersection #{i}</h3>
                            <label># Exits:
                                <input 
                                    type="number" 
                                    min={2} 
                                    max={10}
                                    value={config.numExits} 
                                    onChange={e => handleNumExitsChange(obj.id, Number(e.target.value))}
                                />
                            </label>
                            <button onClick={() => removeObject(obj.id)}>Delete</button>

                            {config.exitConfig.map((exit, j) => (
                                <div key={j}>
                                    <h4>Exit {j}</h4>
                                    <label># Lanes:
                                        <input 
                                            type="range" 
                                            min={2} 
                                            max={obj.config.numExits * 2}
                                            value={exit.laneCount} 
                                            onChange={e => handleLaneCountChange(obj.id, j, Number(e.target.value))}
                                        />
                                    </label><span>{exit.laneCount}</span>
                                    <br />
                                    <label>Length:
                                        <input 
                                            type="range" 
                                            min={10} 
                                            max={70}
                                            value={exit.exitLength} 
                                            onChange={e => handleExitLengthChange(obj.id, j, Number(e.target.value))}
                                        />
                                    </label><span>{exit.exitLength}</span>
                                    <br />
                                    <label># Lanes in: {exit.numLanesIn}</label>
                                        <input
                                            type="range" 
                                            min={1} 
                                            max={exit.laneCount - 1}
                                            value={exit.numLanesIn} 
                                            onChange={e => handleNumLanesInChange(obj.id, j, Number(e.target.value))}
                                        />
                                </div>
                            ))}
                        </div>
                    );
                })}
            </div>
        </>
    );
};