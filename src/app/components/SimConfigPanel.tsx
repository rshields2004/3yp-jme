"use client";

import { useJModellerContext } from "../context/JModellerContext";
import { carClasses } from "../includes/types/carTypes";

export default function SimConfigPanel() {
    const { isConfigConfirmed, simIsRunning, simConfig, setSimConfig } = useJModellerContext();

    // Only show during spawn config phase (confirmed but not running yet)
    if (!isConfigConfirmed || simIsRunning) {
        return null;
    }

    const handleNumberChange = (key: keyof typeof simConfig, value: number) => {
        setSimConfig(prev => ({ ...prev, [key]: value }));
    };

    const handleBooleanChange = (key: keyof typeof simConfig, value: boolean) => {
        setSimConfig(prev => ({ ...prev, [key]: value }));
    };



    return (
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
                maxHeight: 700,
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
                            value={simConfig.spawnRate}
                            onChange={(e) => handleNumberChange("spawnRate", parseFloat(e.target.value) || 0)}
                        />
                    </label>
                    <span>{simConfig.spawnRate.toFixed(1)}</span>
                    <br />
                    <label>Max Vehicles:
                        <input
                            type="range"
                            step="10"
                            min="10"
                            max="500"
                            value={simConfig.maxVehicles}
                            onChange={(e) => handleNumberChange("maxVehicles", parseInt(e.target.value) || 10)}
                        />
                    </label>
                    <span>{simConfig.maxVehicles}</span>
                    <br />
                    <label>Max Spawn Attempts:
                        <input
                            type="range"
                            step="1"
                            min="1"
                            max="50"
                            value={simConfig.maxSpawnAttemptsPerFrame}
                            onChange={(e) => handleNumberChange("maxSpawnAttemptsPerFrame", parseInt(e.target.value) || 1)}
                        />
                    </label>
                    <span>{simConfig.maxSpawnAttemptsPerFrame}</span>
                    <br />
                    <label>Max Spawn Queue:
                        <input
                            type="range"
                            step="5"
                            min="5"
                            max="200"
                            value={simConfig.maxSpawnQueue}
                            onChange={(e) => handleNumberChange("maxSpawnQueue", parseInt(e.target.value) || 5)}
                        />
                    </label>
                    <span>{simConfig.maxSpawnQueue}</span>
                    <br />
                </div>
            </div>

            {/* Car Classes Section */}
            <div style={{ marginBottom: 10 }}>
                <h3>Car Classes</h3>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2px 8px" }}>
                    {carClasses.map(cc => {
                        const enabled = simConfig.enabledCarClasses.includes(cc.bodyType);
                        return (
                            <label key={cc.bodyType} style={{ opacity: enabled ? 1 : 0.5, cursor: "pointer" }}>
                                <input
                                    type="checkbox"
                                    checked={enabled}
                                    onChange={() => {
                                        setSimConfig(prev => {
                                            const cur = prev.enabledCarClasses;
                                            const next = enabled
                                                ? cur.filter(b => b !== cc.bodyType)
                                                : [...cur, cc.bodyType];
                                            // Prevent unchecking all — keep at least one
                                            if (next.length === 0) return prev;
                                            return { ...prev, enabledCarClasses: next };
                                        });
                                    }}
                                    style={{ marginRight: 4 }}
                                />
                                {cc.bodyType}
                            </label>
                        );
                    })}
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
                            value={simConfig.initialSpeed}
                            onChange={(e) => handleNumberChange("initialSpeed", parseFloat(e.target.value) || 0)}
                        />
                    </label>
                    <span>{simConfig.initialSpeed.toFixed(1)}</span>
                    <br />
                    <label>Max Speed:
                        <input
                            type="range"
                            step="0.5"
                            min="1"
                            max="30"
                            value={simConfig.maxSpeed}
                            onChange={(e) => handleNumberChange("maxSpeed", parseFloat(e.target.value) || 1)}
                        />
                    </label>
                    <span>{simConfig.maxSpeed.toFixed(1)}</span>
                    <br />
                    <label>Max Accel:
                        <input
                            type="range"
                            step="0.5"
                            min="0.5"
                            max="15"
                            value={simConfig.maxAccel}
                            onChange={(e) => handleNumberChange("maxAccel", parseFloat(e.target.value) || 0.5)}
                        />
                    </label>
                    <span>{simConfig.maxAccel.toFixed(1)}</span>
                    <br />
                    <label>Max Decel:
                        <input
                            type="range"
                            step="0.5"
                            min="0.5"
                            max="15"
                            value={simConfig.maxDecel}
                            onChange={(e) => handleNumberChange("maxDecel", parseFloat(e.target.value) || 0.5)}
                        />
                    </label>
                    <span>{simConfig.maxDecel.toFixed(1)}</span>
                    <br />
                    <label>Comfort Decel:
                        <input
                            type="range"
                            step="0.5"
                            min="0.5"
                            max="15"
                            value={simConfig.comfortDecel}
                            onChange={(e) => handleNumberChange("comfortDecel", parseFloat(e.target.value) || 0.5)}
                        />
                    </label>
                    <span>{simConfig.comfortDecel.toFixed(1)}</span>
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
                            value={simConfig.minBumperGap}
                            onChange={(e) => handleNumberChange("minBumperGap", parseFloat(e.target.value) || 0)}
                        />
                    </label>
                    <span>{simConfig.minBumperGap.toFixed(1)}</span>
                    <br />
                    <label>Time Headway (s):
                        <input
                            type="range"
                            step="0.1"
                            min="0.1"
                            max="5"
                            value={simConfig.timeHeadway}
                            onChange={(e) => handleNumberChange("timeHeadway", parseFloat(e.target.value) || 0.1)}
                        />
                    </label>
                    <span>{simConfig.timeHeadway.toFixed(1)}</span>
                    <br />
                    <label>Stop Line Offset:
                        <input
                            type="range"
                            step="0.01"
                            min="0"
                            max="2"
                            value={simConfig.stopLineOffset}
                            onChange={(e) => handleNumberChange("stopLineOffset", parseFloat(e.target.value) || 0)}
                        />
                    </label>
                    <span>{simConfig.stopLineOffset.toFixed(2)}</span>
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
                            value={simConfig.yOffset}
                            onChange={(e) => handleNumberChange("yOffset", parseFloat(e.target.value) || 0)}
                        />
                    </label>
                    <span>{simConfig.yOffset.toFixed(2)}</span>
                    <br />
                </div>
            </div>

            {/* Advanced Section */}
            <div style={{ marginBottom: 10 }}>
                <h3>Advanced</h3>
                <div>
                    <label>Enable Lane Queuing:
                        <input
                            type="checkbox"
                            checked={simConfig.enableLaneQueuing}
                            onChange={(e) => handleBooleanChange("enableLaneQueuing", e.target.checked)}
                            style={{ marginLeft: 5 }}
                        />
                    </label>
                    <label>Debug Lane Queues:
                        <input
                            type="checkbox"
                            checked={simConfig.debugLaneQueues}
                            onChange={(e) => handleBooleanChange("debugLaneQueues", e.target.checked)}
                            style={{ marginLeft: 5 }}
                        />
                    </label>
                    <label>Roundabout Decel Zone:
                        <input
                            type="range"
                            step="1"
                            min="5"
                            max="50"
                            value={simConfig.roundaboutDecelZone}
                            onChange={(e) => handleNumberChange("roundaboutDecelZone", parseFloat(e.target.value) || 5)}
                        />
                    </label>
                    <span>{simConfig.roundaboutDecelZone.toFixed(0)}</span>
                    <br />
                </div>
            </div>

            {/* Roundabout Controller */}
            <div style={{ marginBottom: 10 }}>
                <h3>Roundabout Controller</h3>
                <div>
                    <label>Min Gap Distance:
                        <input type="range" step="0.5" min="0.5" max="10"
                            value={simConfig.roundaboutMinGap}
                            onChange={(e) => handleNumberChange("roundaboutMinGap", parseFloat(e.target.value) || 0.5)} />
                    </label>
                    <span>{simConfig.roundaboutMinGap.toFixed(1)}</span>
                    <br />
                    <label>Min Time Gap (s):
                        <input type="range" step="0.1" min="0.1" max="5"
                            value={simConfig.roundaboutMinTimeGap}
                            onChange={(e) => handleNumberChange("roundaboutMinTimeGap", parseFloat(e.target.value) || 0.1)} />
                    </label>
                    <span>{simConfig.roundaboutMinTimeGap.toFixed(1)}</span>
                    <br />
                    <label>Safe Entry Distance:
                        <input type="range" step="1" min="5" max="50"
                            value={simConfig.roundaboutSafeEntryDist}
                            onChange={(e) => handleNumberChange("roundaboutSafeEntryDist", parseFloat(e.target.value) || 5)} />
                    </label>
                    <span>{simConfig.roundaboutSafeEntryDist.toFixed(0)}</span>
                    <br />
                    <label>Entry Timeout (s):
                        <input type="range" step="0.1" min="0.1" max="5"
                            value={simConfig.roundaboutEntryTimeout}
                            onChange={(e) => handleNumberChange("roundaboutEntryTimeout", parseFloat(e.target.value) || 0.1)} />
                    </label>
                    <span>{simConfig.roundaboutEntryTimeout.toFixed(1)}</span>
                    <br />
                    <label>Min Angular Sep (°):
                        <input type="range" step="1" min="5" max="90"
                            value={Math.round(simConfig.roundaboutMinAngularSep * 180 / Math.PI)}
                            onChange={(e) => handleNumberChange("roundaboutMinAngularSep", (parseFloat(e.target.value) || 5) * Math.PI / 180)} />
                    </label>
                    <span>{Math.round(simConfig.roundaboutMinAngularSep * 180 / Math.PI)}°</span>
                    <br />
                </div>
            </div>

            {/* Intersection Controller */}
            <div style={{ marginBottom: 10 }}>
                <h3>Intersection Controller</h3>
                <div>
                    <label>Green Time (s):
                        <input type="range" step="1" min="1" max="30"
                            value={simConfig.intersectionGreenTime}
                            onChange={(e) => handleNumberChange("intersectionGreenTime", parseFloat(e.target.value) || 1)} />
                    </label>
                    <span>{simConfig.intersectionGreenTime.toFixed(0)}</span>
                    <br />
                    <label>Amber Time (s):
                        <input type="range" step="0.5" min="0.5" max="10"
                            value={simConfig.intersectionAmberTime}
                            onChange={(e) => handleNumberChange("intersectionAmberTime", parseFloat(e.target.value) || 0.5)} />
                    </label>
                    <span>{simConfig.intersectionAmberTime.toFixed(1)}</span>
                    <br />
                    <label>Red-Amber Time (s):
                        <input type="range" step="0.5" min="0.5" max="5"
                            value={simConfig.intersectionRedAmberTime}
                            onChange={(e) => handleNumberChange("intersectionRedAmberTime", parseFloat(e.target.value) || 0.5)} />
                    </label>
                    <span>{simConfig.intersectionRedAmberTime.toFixed(1)}</span>
                    <br />
                    <label>All-Red Time (s):
                        <input type="range" step="0.5" min="0.5" max="5"
                            value={simConfig.intersectionAllRedTime}
                            onChange={(e) => handleNumberChange("intersectionAllRedTime", parseFloat(e.target.value) || 0.5)} />
                    </label>
                    <span>{simConfig.intersectionAllRedTime.toFixed(1)}</span>
                    <br />
                </div>
            </div>
        </div>
    );
}
