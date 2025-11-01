"use client";

import { useJModellerContext } from "../context/JModellerContext";
import { defaultIntersectionConfig } from "../includes/defaults";
import { ExitConfig, ExitRef } from "../includes/types";

export default function DebugPanel() {
    const { 
        junction, 
        setJunction, 
        setSelectedJunctionObjectRefs, 
        selectedExits,
        setSelectedExits
    } = useJModellerContext();


    const handleExitNumChange = (intersectionIndex: number, newExitNum: number) => {
        if (newExitNum <= 1) {
            return;
        }

        setJunction((prevJunction) => ({
            ...prevJunction,
            intersections: prevJunction.intersections.map((intersection, index) => {
                if (index === intersectionIndex) {
                    return {
                        ...intersection,
                        numExits: newExitNum,
                        exitConfig: Array.from({ length: newExitNum }, () => ({
                            laneCount: 2,
                            laneWidth: 1.5,
                            exitLength: 40,
                        })),
                    };
                }
                return intersection;
            }),
        }));
    };

    const handleLaneNumChange = (intersectionIndex: number, exitIndex: number, newLaneNum: number) => {
        
        if (newLaneNum <= 1) {
            return;
        }

        setJunction((prevJunction) => ({
            ...prevJunction,
            intersections: prevJunction.intersections.map((intersection, i) => {
                if (i === intersectionIndex) {
                    return {
                        ...intersection,
                        exitConfig: intersection.exitConfig.map((exit, j) =>
                            j === exitIndex ? { ...exit, laneCount: newLaneNum } : exit
                        ),
                    };
                }
                return intersection;
            }),
        }));
    };

    const handleExitLengthChange = (intersectionIndex: number, exitIndex: number, newExitLength: number) => {
        if (newExitLength < 10) {
            return;
        }

        setJunction((prevJunction) => ({
            ...prevJunction,
            intersections: prevJunction.intersections.map((intersection, i) => {
                if (i === intersectionIndex) {
                    return {
                        ...intersection,
                        exitConfig: intersection.exitConfig.map((exit, j) =>
                            j === exitIndex ? { ...exit, exitLength: newExitLength } : exit
                        ),
                    };
                }
                return intersection;
            }),
        }));
    };

    const addNewIntersection = () => {

        setJunction((prevJunction) => ({
            ...prevJunction,
            intersections: [
                ...prevJunction.intersections,
                defaultIntersectionConfig,
            ],
        }));
    }

    const handleRemoveIntersection = (intersectionIndex: number) => {
        setJunction((prevJunction) => ({
            ...prevJunction,
            intersections: prevJunction.intersections.filter(
                (_, index) => index !== intersectionIndex
            )
        }));
        setSelectedJunctionObjectRefs([]);
    };

    const addNewLink = () => {
        if (selectedExits.length < 2) return;

        const newLink: [ExitRef, ExitRef] = [selectedExits[0], selectedExits[1]];

        setJunction(prev => {
           const exists = prev.junctionLinks.some(([a, b]) =>
                (
                    (a.junctionGroup === newLink[0].junctionGroup &&
                        a.exitIndex === newLink[0].exitIndex &&
                        b.junctionGroup === newLink[1].junctionGroup &&
                        b.exitIndex === newLink[1].exitIndex)
                ) ||
                (
                    (a.junctionGroup === newLink[1].junctionGroup &&
                        a.exitIndex === newLink[1].exitIndex &&
                        b.junctionGroup === newLink[0].junctionGroup &&
                        b.exitIndex === newLink[0].exitIndex)
                )
            );
            const conflicts = prev.junctionLinks.some(([a, b]) =>
                [a, b].some(linkExit =>
                    linkExit.junctionGroup === newLink[0].junctionGroup && linkExit.exitIndex === newLink[0].exitIndex ||
                    linkExit.junctionGroup === newLink[1].junctionGroup && linkExit.exitIndex === newLink[1].exitIndex
                )
            );
            if (exists || conflicts) return prev; // don't add duplicate

            return {
                ...prev,
                junctionLinks: [...prev.junctionLinks, newLink],
            };
        });

        setSelectedExits([]);

    };

    const handleRemoveLink = (linkIndex: number) => {
        setJunction(prev => ({
            ...prev,
            junctionLinks: prev.junctionLinks.filter((_, i) => i !== linkIndex)
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
                {junction.junctionLinks.map((link, linkIndex) => {
                    return (
                        <div
                            key={`link-${linkIndex}`}
                        >
                            <p
                                key={`link-${linkIndex}`}
                            >
                                {link[0].structureType} {link[0].structureIndex}, Exit {link[0].exitIndex} - {link[1].structureType} {link[1].structureIndex}, Exit {link[1].exitIndex}
                            </p>
                            <button
                                onClick={() => handleRemoveLink(linkIndex)}
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

                {junction.intersections.map((intersection, intersectionIndex) => {

                    return (
                        <div key={`intersection-${intersectionIndex}`} style={{ marginBottom: "1rem" }}>
                            <h3>{`Intersection #${intersectionIndex}`}</h3>

                            {/* Intersection Config */}
                            <h4>Config</h4>
                            <span># Exit: </span>
                            <input
                                type="number"
                                min={2}
                                value={intersection.numExits}
                                onChange={(e) => handleExitNumChange(intersectionIndex, Number(e.target.value))}
                            />
                            <button
                                onClick={() => handleRemoveIntersection(intersectionIndex)}
                            >Delete Intersection</button>

                            {/* Intersection Structure */}

                            <h4>Structure</h4>

                            {intersection.exitConfig.map((exitConfig: ExitConfig, exitIndex: number) => {
                                

                                return (
                                    <div key={`intersection-${intersectionIndex}-exit-${exitIndex}`}>
                                        <h3>Exit {exitIndex}</h3>
                                        <span># Lanes: </span>
                                        <input
                                            type="number"
                                            min={2}
                                            value={exitConfig.laneCount}
                                            onChange={(e) => handleLaneNumChange(intersectionIndex, exitIndex, Number(e.target.value))}
                                        />
                                        <span>Exit length: </span>
                                        <input
                                            type="number"
                                            min={10}
                                            value={exitConfig.exitLength}
                                            onChange={(e) => handleExitLengthChange(intersectionIndex, exitIndex, Number(e.target.value))}
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