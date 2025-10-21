"use client";

import { useJModellerContext } from "../context/JModellerContext";
import { Exit, LaneLine } from "../includes/types";
import * as THREE from "three";

export default function DebugPanel() {
    const { junction } = useJModellerContext();


    return (
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
                const { intersectionConfig, intersectionStructure } = intersection;

                return (
                    <div key={`intersection-${intersectionIndex}`} style={{ marginBottom: "1rem" }}>
                        <h3>{`Intersection #${intersectionIndex}`}</h3>

                        {/* Intersection Config */}
                        <h4>Config</h4>
                        <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
                            <span>Exits: {intersectionConfig.numExits}</span>
                            <span>Origin: [{intersectionConfig.origin.join(", ")}]</span>
                        </div>

                        {intersectionConfig.exitConfig.map((exitConfig, exitConfigIndex) => (
                            <div
                                key={`intersection-${intersectionIndex}-exitConfig-${exitConfigIndex}`}
                                style={{ paddingLeft: "1rem", display: "flex", gap: "1rem", flexWrap: "wrap" }}
                            >
                                <strong>{`ExitConfig #${exitConfigIndex}`}</strong>
                                <span>Lanes: {exitConfig.laneCount}</span>
                                <span>Width: {exitConfig.laneWidth}</span>
                                <span>Length: {exitConfig.exitLength}</span>
                            </div>
                        ))}

                        {/* Intersection Structure */}
                        {intersectionStructure && (
                            <>
                                <h4>Structure</h4>

                                {intersectionStructure.exitInfo.map((exit: Exit, exitIndex: number) => (
                                    <div
                                        key={`intersection-${intersectionIndex}-exit-${exitIndex}`}
                                        style={{ paddingLeft: "1rem", marginBottom: "0.5rem" }}
                                    >
                                        <h5>{`Exit #${exitIndex}`}</h5>

                                        {/* Stop Lines */}
                                        {exit.stopLines.map((lane: LaneLine, laneIndex: number) => (
                                            <div
                                                key={`intersection-${intersectionIndex}-exit-${exitIndex}-stop-${laneIndex}`}
                                                style={{ display: "flex", gap: "1rem", flexWrap: "wrap", paddingLeft: "1rem" }}
                                            >
                                                <strong>{`StopLine #${laneIndex}`}</strong>
                                                <span>Start: [{lane.start.map(n => n.toFixed(2)).join(", ")}]</span>
                                                <span>End: [{lane.end.map(n => n.toFixed(2)).join(", ")}]</span>
                                                <span>Pattern: {lane.properties.pattern}</span>
                                                <span>Colour: {lane.properties.colour}</span>
                                                <span>Thickness: {lane.properties.thickness}</span>
                                                <span>Glow: {lane.properties.glow}</span>
                                            </div>
                                        ))}

                                        {/* Lane Lines */}
                                        {exit.laneLines.map((lane: LaneLine, laneIndex: number) => (
                                            <div
                                                key={`intersection-${intersectionIndex}-exit-${exitIndex}-lane-${laneIndex}`}
                                                style={{ display: "flex", gap: "1rem", flexWrap: "wrap", paddingLeft: "1rem" }}
                                            >
                                                <strong>{`LaneLine #${laneIndex}`}</strong>
                                                <span>Start: [{lane.start.map(n => n.toFixed(2)).join(", ")}]</span>
                                                <span>End: [{lane.end.map(n => n.toFixed(2)).join(", ")}]</span>
                                                <span>Pattern: {lane.properties.pattern}</span>
                                                <span>Colour: {lane.properties.colour}</span>
                                                <span>Thickness: {lane.properties.thickness}</span>
                                                <span>Glow: {lane.properties.glow}</span>
                                            </div>
                                        ))}
                                    </div>
                                ))}

                                {/* Edge Tubes */}
                                {/* {intersectionStructure.edgeTubes.map((tube: THREE.TubeGeometry, tubeIndex: number) => (
                                    <div
                                        key={`intersection-${intersectionIndex}-tube-${tubeIndex}`}
                                        style={{ paddingLeft: "1rem", display: "flex", gap: "1rem", flexWrap: "wrap" }}
                                    >
                                        <strong>{`EdgeTube #${tubeIndex}`}</strong>
                                        <span>Type: THREE.TubeGeometry</span>
                                        <span>Parameters: {JSON.stringify(tube.parameters)}</span>
                                    </div>
                                ))} */}
                            </>
                        )}
                    </div>
                );
            })}
        </div>
    );
};