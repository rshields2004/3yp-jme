"use client";

import { useJModellerContext } from "../context/JModellerContext";
import { defaultExitConfig, defaultIntersectionConfig, defaultRoundaboutConfig } from "../includes/defaults";
import { IntersectionConfig } from "../includes/types/intersection";
import { ExitConfig, ExitRef, JunctionLink } from "../includes/types/types";

export default function DebugPanel() {
    const {
        junction,
        setJunction,
        selectedExits,
        setSelectedExits,
        removeObject,
        simIsRunning,
        startSim,
        haltSim,
        stats,
        carsReady
    } = useJModellerContext();



    const handleNumExitsChange = (objID: string, value: number) => {
        setJunction(prev => ({
            ...prev,
            junctionObjects: prev.junctionObjects.map(obj =>
                obj.id === objID
                    ? {
                        ...obj,
                        config: {
                            ...obj.config,
                            numExits: value,
                            exitConfig: Array.from(
                                { length: value },
                                (_, j) => (obj.config).exitConfig[j] ?? defaultExitConfig
                            )
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
                obj.id === objID
                    ? {
                        ...obj,
                        config: {
                            ...obj.config,
                            exitConfig: (obj.config).exitConfig.map((ex, idx) =>
                                idx === exitIndex ? { ...ex, exitLength: value } : ex
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

        // Get the exit configs !! NEED TO UPDATE FOR ROUNDABOUTS
        const exitAConfig = junctionoA?.config as IntersectionConfig;
        const exitBConfig = junctionoB?.config as IntersectionConfig;

        if (exitAConfig && exitBConfig) {
            const laneCountA = exitAConfig.exitConfig[exitA.exitIndex].laneCount;
            const laneCountB = exitBConfig.exitConfig[exitB.exitIndex].laneCount;

            const numLaneInA = exitAConfig.exitConfig[exitA.exitIndex].numLanesIn;
            const numLaneInB = exitBConfig.exitConfig[exitB.exitIndex].numLanesIn;

            if (laneCountA === laneCountB && numLaneInA === (laneCountA - numLaneInB)) {
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

    const addNewRoundabout = () => {
        setJunction(prev => ({
            ...prev,
            junctionObjects: [
                ...prev.junctionObjects,
                { id: crypto.randomUUID(), type: "roundabout", config: defaultRoundaboutConfig }
            ]
        }));
    };

    const handleLaneCountChange = (objID: string, exitIndex: number, value: number) => {
        setJunction(prev => {
            // Find any link that contains the current object and exit
            const link = junction.junctionLinks.find(link =>
                link.objectPair.some(ref => ref.structureID === objID && ref.exitIndex === exitIndex)
            );

            // If there is a linked exit, store its object ID and exitIndex
            let linkedRef: ExitRef | null = null;
            if (link) {
                linkedRef = link.objectPair.find(ref => !(ref.structureID === objID && ref.exitIndex === exitIndex)) || null;
            }

            return {
                ...prev,
                junctionObjects: prev.junctionObjects.map(obj => {
                    const updateExitConfig = (exitConfig: ExitConfig[]) =>
                        exitConfig.map((ex, i) => {
                            // Only update the matching exit
                            if (i !== exitIndex) return ex;

                            let newNumLanesIn = ex.numLanesIn;
                            const newLaneCount = value;

                            // Ensure numLanesIn is within 1 .. newLaneCount - 1
                            if (newNumLanesIn < 1 || newNumLanesIn >= newLaneCount) {
                                newNumLanesIn = Math.floor(newLaneCount / 2);
                            }

                            return {
                                ...ex,
                                laneCount: newLaneCount,
                                numLanesIn: 1
                            };
                        });

                    // Update current object
                    if (obj.id === objID) {
                        return {
                            ...obj,
                            config: {
                                ...obj.config,
                                exitConfig: updateExitConfig((obj.config).exitConfig)
                            }
                        };
                    }

                    // Update linked object if exists
                    if (linkedRef && obj.id === linkedRef.structureID) {
                        return {
                            ...obj,
                            config: {
                                ...obj.config,
                                exitConfig: (obj.config).exitConfig.map((ex, i) => {
                                    if (i !== linkedRef!.exitIndex) return ex;

                                    let newNumLanesIn = ex.numLanesIn;
                                    const newLaneCount = value;

                                    if (newNumLanesIn < 1 || newNumLanesIn >= newLaneCount) {
                                        newNumLanesIn = Math.floor(newLaneCount / 2);
                                    }

                                    return {
                                        ...ex,
                                        laneCount: newLaneCount,
                                        numLanesIn: newLaneCount - 1
                                    };
                                })
                            }
                        };
                    }

                    return obj;
                })
            };
        });
    };

    const handleNumLanesInChange = (objID: string, exitIndex: number, value: number) => {
        setJunction(prev => {
            // Find object we're editing from *prev* (not closure `junction`)
            const thisObj = prev.junctionObjects.find(o => o.id === objID);
            if (!thisObj) return prev;

            // Find any link that contains the current object and exit (use prev)
            const link = prev.junctionLinks.find(l =>
                l.objectPair.some(ref => ref.structureID === objID && ref.exitIndex === exitIndex)
            );

            // If there is a linked exit, store its object ID and exitIndex
            let linkedRef: ExitRef | null = null;
            if (link) {
                linkedRef =
                    link.objectPair.find(ref => !(ref.structureID === objID && ref.exitIndex === exitIndex)) || null;
            }

            const exits = thisObj.config.exitConfig;

            // ----- Per-exit clamp -----
            const laneCountHere = exits[exitIndex].laneCount;
            let clamped = Math.max(0, Math.min(value, laneCountHere - 1)); // Must have at least 1 lane out

            // ----- Constraint: numLanesIn for this exit <= total lanes OUT from all OTHER exits -----
            // Calculate total lanes out from other exits (not including current exit)
            const totalLanesOutFromOtherExits = exits.reduce((sum, ex, idx) => {
                if (idx === exitIndex) return sum;
                return sum + (ex.laneCount - ex.numLanesIn);
            }, 0);

            // Clamp to not exceed the lanes available from other exits
            clamped = Math.min(clamped, totalLanesOutFromOtherExits);

            // Ensure at least 0
            clamped = Math.max(0, clamped);

            return {
                ...prev,
                junctionObjects: prev.junctionObjects.map(obj => {
                    // Update current object
                    if (obj.id === objID) {
                        return {
                            ...obj,
                            config: {
                                ...obj.config,
                                exitConfig: obj.config.exitConfig.map((ex, idx) =>
                                    idx === exitIndex ? { ...ex, numLanesIn: clamped } : ex
                                ),
                            },
                        };
                    }

                    // Update linked object if exists:
                    // Keep TOTAL lanes on that linked exit constant: numLanesIn + numLanesOut = laneCount
                    if (linkedRef && obj.id === linkedRef.structureID) {
                        return {
                            ...obj,
                            config: {
                                ...obj.config,
                                exitConfig: obj.config.exitConfig.map((ex, idx) => {
                                    if (idx !== linkedRef!.exitIndex) return ex;

                                    // value drives the opposite side's in-lanes on the linked exit
                                    const newLinkedIn = Math.max(0, Math.min(ex.laneCount, ex.laneCount - clamped));
                                    return { ...ex, numLanesIn: newLinkedIn };
                                }),
                            },
                        };
                    }

                    return obj;
                }),
            };
        });
    };




    return (
        <>
            <div
                style={{
                    position: "absolute",
                    top: 10,
                    right: 500,
                    padding: 10,
                    background: "rgba(0,0,0,0.7)",
                    color: "white",
                    borderRadius: 8,
                    minWidth: 320,
                    fontFamily: "system-ui, sans-serif"
                }}
            >
                <h1 style={{ margin: "0 0 8px 0", fontSize: 18 }}>Simulation Control</h1>

                {/* Loading indicator */}
                <div style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 12, marginBottom: 4, opacity: 0.8 }}>
                        {carsReady ? "Car models loaded ✓" : "Loading car models..."}
                    </div>
                    <div style={{
                        width: "100%",
                        height: 6,
                        background: "rgba(255,255,255,0.2)",
                        borderRadius: 3,
                        overflow: "hidden"
                    }}>
                        <div style={{
                            width: carsReady ? "100%" : "30%",
                            height: "100%",
                            background: carsReady 
                                ? "#4CAF50" 
                                : "linear-gradient(90deg, #4CAF50, #8BC34A)",
                            borderRadius: 3,
                            transition: carsReady ? "width 0.3s ease-out" : "none",
                            animation: carsReady ? "none" : "loadingPulse 1.5s ease-in-out infinite"
                        }} />
                    </div>
                    {!carsReady && (
                        <style>{`
                            @keyframes loadingPulse {
                                0%, 100% { width: 20%; margin-left: 0%; }
                                50% { width: 40%; margin-left: 60%; }
                            }
                        `}</style>
                    )}
                </div>

                <button disabled={simIsRunning || !carsReady} onClick={() => startSim()}>
                    {carsReady ? "Start Simulation" : "Loading..."}
                </button>
                <br />
                <button disabled={!simIsRunning} onClick={() => haltSim()}>
                    Stop Simulation
                </button>

                <hr style={{ margin: "10px 0", opacity: 0.3 }} />

                <h2 style={{ margin: "0 0 8px 0", fontSize: 14, opacity: 0.9 }}>
                    Global Stats
                </h2>

                <div style={{ fontSize: 13, lineHeight: 1.35 }}>
                    <div><b>Active:</b> {stats.active}</div>
                    <div><b>Spawn queue:</b> {stats.spawnQueue}</div>
                    <div><b>Spawned:</b> {stats.spawned}</div>
                    <div><b>Completed:</b> {stats.completed}</div>
                    <div><b>Routes:</b> {stats.routes}</div>
                    <div><b>Elapsed Time:</b> {stats.elapsedTime.toFixed(1)}s</div>

                    <hr style={{ margin: "8px 0", opacity: 0.2 }} />

                    <div style={{ opacity: 0.9 }}>
                        <div style={{ fontWeight: 700, marginBottom: 4 }}>
                            Junctions ({stats.junctions.global.count})
                        </div>

                        <div>
                            <b>Approaching:</b> {stats.junctions.global.approaching}{" "}
                            <b>Waiting:</b> {stats.junctions.global.waiting}{" "}
                            <b>Inside:</b> {stats.junctions.global.inside}{" "}
                            <b>Exiting:</b> {stats.junctions.global.exiting}
                        </div>

                        <div>
                            <b>Entered:</b> {stats.junctions.global.entered}{" "}
                            <b>Exited:</b> {stats.junctions.global.exited}{" "}
                        </div>
                        
                        <div>
                            <b>Avg Wait Time:</b> {stats.junctions.global.avgWaitTime.toFixed(1)}s
                        </div>
                    </div>
                </div>
            </div>

            <fieldset
                disabled={simIsRunning}
                style={{
                    fontFamily: "system-ui, sans-serif"
                }}
            >
                {/* Add new object */}
                <div style={{ position: "absolute", top: 10, right: 10, padding: 10, background: "rgba(0,0,0,0.7)", color: "white", borderRadius: 8, minWidth: 300 }}>
                    <h2>Add Intersection</h2>
                    <button onClick={addNewIntersection}>Add New</button>
                    <h2>Add Roundabout</h2>
                    <button onClick={addNewRoundabout}>Add New</button>
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
                    {junction.junctionObjects.filter(obj => obj.type === "intersection").map((obj) => {
                        const config = obj.config as IntersectionConfig;
                        return (
                            <div key={obj.id} style={{ marginBottom: "1rem" }}>
                                <h3>Intersection {obj.id.slice(0, 6)}</h3>
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
                {/* Roundabout Config Panel */}
                <div style={{ position: "absolute", bottom: 10, left: 10, padding: 10, background: "rgba(0,0,0,0.7)", color: "white", borderRadius: 8, minWidth: 300, maxHeight: "40vh", overflowY: "auto" }}>
                    <h2>Roundabout</h2>
                    {junction.junctionObjects.filter(obj => obj.type === "roundabout").map((obj) => {
                        const config = obj.config as IntersectionConfig;
                        return (
                            <div key={obj.id} style={{ marginBottom: "1rem" }}>
                                <h3>Roundabout {obj.id.slice(0, 6)}</h3>
                                <label># Exits:
                                    <input
                                        type="number"
                                        min={2}
                                        max={6}
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
                                                min={20}
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
            </fieldset>
        </>
    );
};