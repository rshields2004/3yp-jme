/**
 * saveLoad.ts
 *
 * Handles downloading and uploading .jme save files, which contain
 * the junction configuration and simulation config as serialised JSON.
 */

import { JunctionConfig } from "./types/types";
import { SimConfig } from "./types/simulation";

// TYPES

/**
 * Shape of the persisted save file.
 */
export type SaveFile = {
    version: 1;
    name: string;
    savedAt: string;
    junctionConfig: JunctionConfig;
    simConfig: SimConfig;
};

// SAVE AND LOAD

/**
 * Serialises the current config and triggers a browser download as a .jme file.
 *
 * @param junctionConfig - the junction configuration to save
 * @param simConfig - the simulation configuration
 * @param name - file name for the download
 */
export const downloadSave = (
    junctionConfig: JunctionConfig,
    simConfig: SimConfig,
    name = "junction"
): void => {
    const save: SaveFile = {
        version: 1,
        name,
        savedAt: new Date().toISOString(),
        junctionConfig,
        simConfig,
    };

    const blob = new Blob([JSON.stringify(save, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${name}-${Date.now()}.jme`;
    a.click();
    URL.revokeObjectURL(url);
};

/**
 * Opens a file picker and parses the selected .jme/.json save file.
 * @returns the parsed save-file contents
 */
export const loadSaveFromFile = (): Promise<SaveFile> => {
    return new Promise((resolve, reject) => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".jme,.json";
        input.onchange = async () => {
            const file = input.files?.[0];
            if (!file) {
                return reject(new Error("No file selected"));
            }
            try {
                const text = await file.text();
                const save = JSON.parse(text) as SaveFile;
                if (save.version !== 1) {
                    throw new Error("Unknown save version");
                }
                if (!save.junctionConfig || !save.simConfig) {
                    throw new Error("Invalid save file");
                }
                resolve(save);
            } 
            catch (error) {
                reject(error)
            }
        };
        input.click();
    });
};