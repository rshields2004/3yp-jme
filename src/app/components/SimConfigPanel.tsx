"use client";

import { useJModellerContext } from "../context/JModellerContext";
import { carClasses } from "../includes/types/carTypes";

export default function SimConfigPanel() {
    const { isConfigConfirmed, simIsRunning, simConfig, setSimConfig } = useJModellerContext();


    type ConfigPath = readonly (string | number)[];

    function setByPath<T extends object>(
        obj: T,
        path: ConfigPath,
        value: number
    ): T {
        const [head, ...rest] = path;
        if (!head) {
            return obj;
        }

        return {
            ...obj,
            [head]:
                rest.length === 0 ? value : setByPath((obj as any)[head], rest, value)
        };
    }

    const handleNumberChange = (path: ConfigPath, value: number) => {
        setSimConfig(prev => setByPath(prev, path, value));
    }


    return isConfigConfirmed && !simIsRunning && (
        <div
            style={{
                position: "absolute",
                bottom: 10,
                right: 10,
                background: "rgba(0,0,0,0.7)",
                color: "white",
                padding: 10,
                borderRadius: 8,
                fontFamily: "system-ui, sans-serif",
                maxHeight: 600,
                overflowY: "auto",
                minWidth: 280,
            }}
        >
            <h2>Simulation Config</h2>

            {/* Spawning Section */}
            <div style={{ marginBottom: 10 }}>
                <h3>Spawning</h3>
                <div>
                    <label>Seed:
                        <input
                            type="text"
                            value={simConfig.simSeed}
                            onChange={(e) => setSimConfig(prev => ({ ...prev, simSeed: e.target.value }))}
                            style={{ width: 120, marginLeft: 5, color: "black" }}
                        />
                    </label>
                    <br />
                    <label>Global Spawn Rate (veh/s):
                        <input
                            type="range"
                            step="0.1"
                            min="0"
                            max="10"
                            value={simConfig.spawning.spawnRate}
                            onChange={(e) => handleNumberChange(["spawning", "spawnRate"], parseInt(e.target.value))}
                        />
                    </label>
                    <span>{simConfig.spawning.spawnRate.toFixed(1)}</span>
                    <br />
                    <label>Max Vehicles:
                        <input
                            type="range"
                            step="10"
                            min="10"
                            max="500"
                            value={simConfig.spawning.maxVehicles}
                            onChange={(e) =>  handleNumberChange(["spawning", "maxVehicles"], parseInt(e.target.value))}
                        />
                    </label>
                    <span>{simConfig.spawning.maxVehicles}</span>
                    <br />
                    <label>Max Spawn Attempts:
                        <input
                            type="range"
                            step="1"
                            min="1"
                            max="50"
                            value={simConfig.spawning.maxSpawnAttemptsPerFrame}
                            onChange={(e) =>  handleNumberChange(["spawning", "maxSpawnAttemptsPerFrame"], parseInt(e.target.value))}
                        />
                    </label>
                    <span>{simConfig.spawning.maxSpawnAttemptsPerFrame}</span>
                    <br />
                    <label>Max Spawn Queue:
                        <input
                            type="range"
                            step="5"
                            min="5"
                            max="200"
                            value={simConfig.spawning.maxSpawnQueue}
                            onChange={(e) =>  handleNumberChange(["spawning", "maxSpawnQueue"], parseInt(e.target.value))}
                        />
                    </label>
                    <span>{simConfig.spawning.maxSpawnQueue}</span>
                    <br />
                </div>
            </div>

            {/* Car Classes Section */}
            <div style={{ marginBottom: 10 }}>
                <h3>Car Classes</h3>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2px 8px" }}>
                    {carClasses.map(cc => {
                        const enabled = simConfig.rendering.enabledCarClasses.includes(cc.bodyType);
                        return (
                            <label key={cc.bodyType} style={{ opacity: enabled ? 1 : 0.5, cursor: "pointer" }}>
                                <input
                                    type="checkbox"
                                    checked={enabled}
                                    onChange={() => {
                                        setSimConfig(prev => {
                                            const cur = prev.rendering.enabledCarClasses;
                                            const next = enabled ? cur.filter(b => b !== cc.bodyType) : [...cur, cc.bodyType];
                                            // Prevent unchecking all — keep at least one
                                            if (next.length === 0) {
                                                return prev;
                                            }
                                            return { 
                                                ...prev, 
                                                rendering: {
                                                    ...prev.rendering,
                                                    enabledCarClasses: next
                                                }
                                            };
                                        });
                                    }}
                                    style={{ marginRight: 4 }}
                                />
                                {cc.bodyType}
                            </label>
                        );
                    })}
                    <button
                        onClick={() => setSimConfig(prev => {
                            return {
                                ...prev,
                                rendering : {
                                    ...prev.rendering,
                                    enabledCarClasses: ["coupe"]
                                }
                            }
                        })}
                    >
                    Unselect All</button>
                </div>
            </div>

            {/* Motion Section */}
            <div style={{ marginBottom: 10 }}>
                <h3>Motion</h3>
                <div>
                    <label>Initial Speed:
                        <input
                            type="range"
                            step="0.5"
                            min="0"
                            max="20"
                            value={simConfig.motion.initialSpeed}
                            onChange={(e) =>  handleNumberChange(["motion", "initialSpeed"], parseInt(e.target.value))}
                        />
                    </label>
                    <span>{simConfig.motion.initialSpeed.toFixed(1)}</span>
                    <br />
                    <label>Preferred Speed:
                        <input
                            type="range"
                            step="0.5"
                            min="1"
                            max="30"
                            value={simConfig.motion.preferredSpeed}
                            onChange={(e) => handleNumberChange(["motion", "preferredSpeed"], parseInt(e.target.value))}
                        />
                    </label>
                    <span>{simConfig.motion.preferredSpeed.toFixed(1)}</span>
                    <br />
                    <label>Max Accel:
                        <input
                            type="range"
                            step="0.5"
                            min="0.5"
                            max="15"
                            value={simConfig.motion.maxAccel}
                            onChange={(e) => handleNumberChange(["motion", "maxAccel"], parseInt(e.target.value))}
                        />
                    </label>
                    <span>{simConfig.motion.maxAccel.toFixed(1)}</span>
                    <br />
                    <label>Max Decel:
                        <input
                            type="range"
                            step="0.5"
                            min="0.5"
                            max="15"
                            value={simConfig.motion.maxDecel}
                            onChange={(e) => handleNumberChange(["motion", "maxDecel"], parseInt(e.target.value))}
                        />
                    </label>
                    <span>{simConfig.motion.maxDecel.toFixed(1)}</span>
                    <br />
                    <label>Comfort Decel:
                        <input
                            type="range"
                            step="0.5"
                            min="0.5"
                            max="15"
                            value={simConfig.motion.comfortDecel}
                            onChange={(e) => handleNumberChange(["motion", "comfortDecel"], parseInt(e.target.value))}
                        />
                    </label>
                    <span>{simConfig.motion.comfortDecel.toFixed(1)}</span>
                    <br />
                </div>
            </div>

            {/* Spacing Section */}
            <div style={{ marginBottom: 10 }}>
                <h3>Spacing</h3>
                <div>
                    <label>Min Bumper Gap:
                        <input
                            type="range"
                            step="0.1"
                            min="0"
                            max="5"
                            value={simConfig.spacing.minBumperGap}
                            onChange={(e) => handleNumberChange(["spacing", "minBumperGap"], parseInt(e.target.value))}
                        />
                    </label>
                    <span>{simConfig.spacing.minBumperGap.toFixed(1)}</span>
                    <br />
                    <label>Time Headway (s):
                        <input
                            type="range"
                            step="0.1"
                            min="0.1"
                            max="5"
                            value={simConfig.spacing.timeHeadway}
                            onChange={(e) => handleNumberChange(["spacing", "timeHeadway"], parseInt(e.target.value))}
                        />
                    </label>
                    <span>{simConfig.spacing.timeHeadway.toFixed(1)}</span>
                    <br />
                    <label>Stop Line Offset:
                        <input
                            type="range"
                            step="0.01"
                            min="0"
                            max="2"
                            value={simConfig.spacing.stopLineOffset}
                            onChange={(e) => handleNumberChange(["spacing", "stopLineOffset"], parseInt(e.target.value))}
                        />
                    </label>
                    <span>{simConfig.spacing.stopLineOffset.toFixed(2)}</span>
                    <br />
                </div>
            </div>

            {/* Rendering Section */}
            <div style={{ marginBottom: 10 }}>
                <h3>Rendering</h3>
                <div>
                    <label>Y Offset:
                        <input
                            type="range"
                            step="0.01"
                            min="0"
                            max="1"
                            value={simConfig.rendering.yOffset}
                            onChange={(e) => handleNumberChange(["rendering", "yOffset"], parseInt(e.target.value))}
                        />
                    </label>
                    <span>{simConfig.rendering.yOffset.toFixed(2)}</span>
                    <br />
                </div>
            </div>

            {/* Roundabout Controller */}
            <div style={{ marginBottom: 10 }}>
                <h3>Roundabout Controller</h3>
                <div>
                    <label>Min Gap Distance:
                        <input type="range" step="0.5" min="0.5" max="10"
                            value={simConfig.controllers.roundabout.roundaboutMinGap}
                            onChange={(e) =>  handleNumberChange(["controllers", "roundabout", "roundaboutMinGap"], parseFloat(e.target.value))} />
                    </label>
                    <span>{simConfig.controllers.roundabout.roundaboutMinGap.toFixed(1)}</span>
                    <br />
                    <label>Min Time Gap (s):
                        <input type="range" step="0.1" min="0.1" max="5"
                            value={simConfig.controllers.roundabout.roundaboutMinTimeGap}
                            onChange={(e) => handleNumberChange(["controllers", "roundabout", "roundaboutMinTimeGap"], parseFloat(e.target.value) || 0.1)} />
                    </label>
                    <span>{simConfig.controllers.roundabout.roundaboutMinTimeGap.toFixed(1)}</span>
                    <br />
                    <label>Safe Entry Distance:
                        <input type="range" step="1" min="5" max="50"
                            value={simConfig.controllers.roundabout.roundaboutSafeEntryDist}
                            onChange={(e) => handleNumberChange(["controllers", "roundabout", "roundaboutSafeEntryDist"], parseFloat(e.target.value) || 5)} />
                    </label>
                    <span>{simConfig.controllers.roundabout.roundaboutSafeEntryDist.toFixed(0)}</span>
                    <br />
                    <label>Entry Timeout (s):
                        <input type="range" step="0.1" min="0.1" max="5"
                            value={simConfig.controllers.roundabout.roundaboutEntryTimeout}
                            onChange={(e) => handleNumberChange(["controllers", "roundabout", "roundaboutEntryTimeout"], parseFloat(e.target.value) || 0.1)} />
                    </label>
                    <span>{simConfig.controllers.roundabout.roundaboutEntryTimeout.toFixed(1)}</span>
                    <br />
                    <label>Min Angular Sep (°):
                        <input type="range" step="1" min="5" max="90"
                            value={Math.round(simConfig.controllers.roundabout.roundaboutMinAngularSep * 180 / Math.PI)}
                            onChange={(e) => handleNumberChange(["controllers", "roundabout", "roundaboutMinAngularSep"], (parseFloat(e.target.value) || 5) * Math.PI / 180)} />
                    </label>
                    <span>{Math.round(simConfig.controllers.roundabout.roundaboutMinAngularSep * 180 / Math.PI)}°</span>
                    <br />
                </div>
            </div>

            {/* Intersection Controller */}
            <div style={{ marginBottom: 10 }}>
                <h3>Intersection Controller</h3>
                <div>
                    <label>Green Time (s):
                        <input type="range" step="0.1" min="0.1" max="30"
                            value={simConfig.controllers.intersection.intersectionGreenTime}
                            onChange={(e) => handleNumberChange(["controllers", "intersection", "intersectionGreenTime"], parseFloat(e.target.value) || 1)} />
                    </label>
                    <span>{simConfig.controllers.intersection.intersectionGreenTime.toFixed(1)}</span>
                    <br />
                    <label>Amber Time (s):
                        <input type="range" step="0.1" min="0.1" max="10"
                            value={simConfig.controllers.intersection.intersectionAmberTime}
                            onChange={(e) => handleNumberChange(["controllers", "intersection", "intersectionAmberTime"], parseFloat(e.target.value) || 0.5)} />
                    </label>
                    <span>{simConfig.controllers.intersection.intersectionAmberTime.toFixed(1)}</span>
                    <br />
                    <label>Red-Amber Time (s):
                        <input type="range" step="0.1" min="0.1" max="5"
                            value={simConfig.controllers.intersection.intersectionRedAmberTime}
                            onChange={(e) => handleNumberChange(["controllers", "intersection", "intersectionRedAmberTime"], parseFloat(e.target.value) || 0.5)} />
                    </label>
                    <span>{simConfig.controllers.intersection.intersectionRedAmberTime.toFixed(1)}</span>
                    <br />
                    <label>All-Red Time (s):
                        <input type="range" step="0.1" min="0.1" max="5"
                            value={simConfig.controllers.intersection.intersectionAllRedTime}
                            onChange={(e) => handleNumberChange(["controllers", "intersection", "intersectionAllRedTime"], parseFloat(e.target.value) || 0.5)} />
                    </label>
                    <span>{simConfig.controllers.intersection.intersectionAllRedTime.toFixed(1)}</span>
                    <br />
                </div>
            </div>
        </div>
    );
}
