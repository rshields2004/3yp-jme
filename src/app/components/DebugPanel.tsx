"use client";

import { useJModellerContext } from "../context/JModellerContext";
import { defaultExitConfig, defaultIntersectionConfig } from "../includes/defaults";
import { ExitConfig, ExitRef, IntersectionConfig, JunctionLink } from "../includes/types";

export default function DebugPanel() {
    const { 
        junction, 
        setJunction, 
        setSelectedJunctionObjectRefs, 
        selectedExits,
        setSelectedExits,
        junctionObjectRefs,
        snapToValidPosition
    } = useJModellerContext();


    const handleExitNumChange = (objID: string, newExitNum: number) => {
    if (newExitNum <= 1) return;

    setJunction(prevJunction => {
        const updatedJunctionObjects = prevJunction.junctionObjects.map(obj => {
            if (obj.id === objID && obj.type === "intersection") {
                const oldExits = obj.config.exitConfig;

                let newExitConfig: ExitConfig[];
                
                if (newExitNum > oldExits.length) {
                    const additionalExits = Array.from({ length: newExitNum - oldExits.length }, () => (defaultExitConfig));
                    newExitConfig = [...oldExits, ...additionalExits];
                } 
                
                else {
                    newExitConfig = oldExits.slice(0, newExitNum);
                }

                return {
                    ...obj,
                    config: {
                        ...obj.config,
                        numExits: newExitNum,
                        exitConfig: newExitConfig,
                    },
                };
            }
            return obj;
        });

        // Remove links that reference removed exits
        const updatedJunctionLinks = prevJunction.junctionLinks.filter(link =>
            link.objectPair.every(exitRef => {
                const obj = updatedJunctionObjects.find(o => o.id === exitRef.structureID);
                if (!obj) return false;

                return exitRef.exitIndex < obj.config.exitConfig.length;
            })
        );

        return {
            ...prevJunction,
            junctionObjects: updatedJunctionObjects,
            junctionLinks: updatedJunctionLinks,
        };
    });
};

    const handleLaneNumChange = (objID: string, exitIndex: number, newLaneNum: number) => {
        
        if (newLaneNum <= 1) {
            return;
        }
        
        setJunction(prevJunction => ({
            ...prevJunction,
            junctionObjects: prevJunction.junctionObjects.map(jObj => {
                if (jObj.id === objID && jObj.type === "intersection") {
                    return {
                        ...jObj,
                        config: {
                            ...jObj.config,
                            exitConfig: jObj.config.exitConfig.map((exit, j) => j === exitIndex ? { ... exit, laneCount: newLaneNum} : exit),
                        },
                    };
                }
                return jObj;
            }),
        }));
    };

    const handleExitLengthChange = (objID: string, exitIndex: number, newExitLength: number) => {
        if (newExitLength < 10) {
            return;
        }

        setJunction(prevJunction => ({
            ...prevJunction,
            junctionObjects: prevJunction.junctionObjects.map(jObj => {
                if (jObj.id === objID && jObj.type === "intersection") {
                    return {
                        ...jObj,
                        config: {
                            ...jObj.config,
                            exitConfig: jObj.config.exitConfig.map((exit, j) => j === exitIndex ? { ... exit, exitLength: newExitLength} : exit),
                        },
                    };
                }
                return jObj;
            }),
        }));
    };

    const addNewIntersection = () => {

        const newID = crypto.randomUUID();
        setJunction((prevJunction) => ({
            ...prevJunction,
            junctionObjects: [
                ...prevJunction.junctionObjects,
                { 
                    id: newID, 
                    type: "intersection",
                    config: defaultIntersectionConfig,
                }
            ],
        }));
    };

    const handleRemoveObj = (objID: string) => {
        setJunction((prevJunction) => ({
            ...prevJunction,
            junctionObjects: prevJunction.junctionObjects.filter((obj, _) => obj.id !== objID)
        }));
        setSelectedJunctionObjectRefs([]);
    };

    const addNewLink = () => {
        if (selectedExits.length !== 2) return;

        const newLinkPair: [ExitRef, ExitRef] = [selectedExits[0], selectedExits[1]];

        setJunction(prev => {
            
            const exists = prev.junctionLinks.some(link => {
            const [a, b] = link.objectPair
            return    (
                    (a.structureID === newLinkPair[0].structureID &&
                        a.exitIndex === newLinkPair[0].exitIndex &&
                        b.structureID === newLinkPair[1].structureID &&
                        b.exitIndex === newLinkPair[1].exitIndex)
                ) ||
                (
                    (a.structureID === newLinkPair[1].structureID &&
                        a.exitIndex === newLinkPair[1].exitIndex &&
                        b.structureID === newLinkPair[0].structureID &&
                        b.exitIndex === newLinkPair[0].exitIndex)
                );
            });

            const conflicts = prev.junctionLinks.some(link =>
                link.objectPair.some(linkExit =>
                    (linkExit.junctionGroup === newLinkPair[0].junctionGroup && linkExit.exitIndex === newLinkPair[0].exitIndex) ||
                    (linkExit.junctionGroup === newLinkPair[1].junctionGroup && linkExit.exitIndex === newLinkPair[1].exitIndex)
                )
            );

            if (exists || conflicts) return prev; // don't add duplicate

            const newLink: JunctionLink = {
                id: crypto.randomUUID(),
                objectPair: newLinkPair,
            };

            return {
                ...prev,
                junctionLinks: [...prev.junctionLinks, newLink],
            };
        });
        setSelectedExits([]);
    };

    const handleRemoveLink = (linkID: string) => {
        setJunction(prev => ({
            ...prev,
            junctionLinks: prev.junctionLinks.filter((link, _) => link.id !== linkID),
        }));
    };

    return (
        <>
        <div
            style={{
                position: "absolute",
                top: 10,
                right: 10,
                padding: 10,
                background: "rgba(0,0,0,0.7)",
                color: "white",
                borderRadius: 8,
                maxHeight: "40vh",
                overflowY: "auto",
                fontFamily: "sans-serif",
                minWidth: 400,
            }}
            >
                <h1>Add new intersection</h1>
                <button
                    onClick={() => addNewIntersection()}
                >
                    Add new intersection
                </button>
        </div>
        <div
            style={{
                position: "absolute",
                bottom: 10,
                right: 10,
                padding: 10,
                background: "rgba(0,0,0,0.7)",
                color: "white",
                borderRadius: 8,
                maxHeight: "40vh",
                overflowY: "auto",
                fontFamily: "sans-serif",
                minWidth: 400,
            }}
            >
                <h1>Exit Links</h1>
                <button
                    onClick={() => addNewLink()}
                    disabled={selectedExits.length !== 2}
                >Add new link</button>
                {junction.junctionLinks.map((link, _) => {
                    return (
                        <div
                            key={`link-${link.id}`}
                        >
                            <p
                                key={`link-${link.id}`}
                            >
                                {link.objectPair[0].structureType} {link.objectPair[0].structureIndex}, Exit {link.objectPair[0].exitIndex} - {link.objectPair[1].structureType} {link.objectPair[1].structureIndex}, Exit {link.objectPair[1].exitIndex}
                            </p>
                            <button
                                onClick={() => handleRemoveLink(link.id)}
                            >Remove Link</button>
                        </div>
                    )
                })}
                
        </div>
            <div
                style={{
                    position: "absolute",
                    top: 10,
                    left: 10,
                    padding: 10,
                    background: "rgba(0,0,0,0.7)",
                    color: "white",
                    borderRadius: 8,
                    maxHeight: "40vh",
                    overflowY: "auto",
                    fontFamily: "sans-serif",
                    minWidth: 400,
                }}
            >
                <h1>Junction Debug Panel</h1>
                <h2>Intersections</h2>

                {junction.junctionObjects.filter(obj => obj.type === "intersection").map((obj, i) => {
                   const intersectionConfig = obj.config as IntersectionConfig;
                   return (
                        <div key={`intersection-${i}`} style={{ marginBottom: "1rem" }}>
                            <h3>{`Intersection #${i}`}</h3>

                            {/* Intersection Config */}
                            <h4>Config</h4>
                            <span># Exit: </span>
                            <input
                                type="number"
                                min={2}
                                value={intersectionConfig.numExits}
                                onChange={(e) => handleExitNumChange(obj.id, Number(e.target.value))}
                            />
                            <button
                                onClick={() => handleRemoveObj(obj.id)}
                            >Delete Intersection</button>

                            {/* Intersection Structure */}

                            <h4>Structure</h4>

                            {intersectionConfig.exitConfig.map((exitConfig: ExitConfig, j: number) => {
                                

                                return (
                                    <div key={`intersection-${i}-exit-${j}`}>
                                        <h3>Exit {j}</h3>
                                        <span># Lanes: </span>
                                        <input
                                            type="number"
                                            min={2}
                                            value={exitConfig.laneCount}
                                            onChange={(e) => handleLaneNumChange(obj.id, j, Number(e.target.value))}
                                        />
                                        <span>Exit length: </span>
                                        <input
                                            type="number"
                                            min={10}
                                            value={exitConfig.exitLength}
                                            onChange={(e) => handleExitLengthChange(obj.id, j, Number(e.target.value))}
                                        />
                                    </div>
                                );
                            })}

                        </div>
                    );
                })}
            </div>
        </>
    );
};