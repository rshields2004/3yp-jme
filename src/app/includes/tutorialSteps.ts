export type TooltipPosition = "top" | "bottom" | "left" | "right" | "center" | "top-right";

export type TutorialStep = {
    id: string;
    title: string;
    description: string;
    /** CSS selector for the element to highlight / point at */
    target: string;
    /** What the user must do: "click" a button, "drag" on the canvas, "right-click", etc. */
    action: string;
    /** Tooltip position relative to the target */
    position: TooltipPosition;
    /** If true, advance automatically when the expected action is detected */
    autoAdvance: boolean;
    /** Custom label for the Next button (default: "Next →") */
    nextLabel?: string;
};

export const TUTORIAL_STEPS: TutorialStep[] = [
    // ── 1. Switch to Build mode ───────────────────────────────────────
    {
        id: "open-modes",
        title: "Open the Modes Menu",
        description: "Click the 'Modes' tab in the header to open the mode selector.",
        target: "[data-menu-id='modes']",
        action: "click",
        position: "bottom",
        autoAdvance: true,
    },
    {
        id: "enter-build-mode",
        title: "Enter Build Mode",
        description: "Click the 'Build' button to switch into Build mode. This gives you a top-down view and lets you place and edit junction objects.",
        target: "[data-tool-mode='build']",
        action: "click",
        position: "bottom",
        autoAdvance: true,
    },

    // ── 2. Add an intersection ────────────────────────────────────────
    {
        id: "add-intersection",
        title: "Add an Intersection",
        description: "Click '+ Intersection' to place a new traffic-light intersection at the origin.",
        target: "[data-action='add-intersection']",
        action: "click",
        position: "bottom",
        autoAdvance: true,
    },

    // ── 3. Move the intersection to the left ──────────────────────────
    {
        id: "drag-intersection",
        title: "Move the Intersection",
        description: "Click and drag the intersection on the canvas to move it to the left. This frees up space for additional junctions.",
        target: "canvas",
        action: "drag",
        position: "top",
        autoAdvance: false,
    },

    // ── 4. Customise the intersection (more exits) ────────────────────
    {
        id: "select-intersection",
        title: "Select the Intersection",
        description: "Double-click the intersection to open its config panel on the left side of the screen.",
        target: "canvas",
        action: "dblclick",
        position: "top",
        autoAdvance: true,
    },
    {
        id: "add-exits",
        title: "Add More Exits",
        description: "In the Selection Panel, increase the 'Number of Exits' slider to add more arms to the intersection.",
        target: "[data-slider='numExits']",
        action: "drag",
        position: "right",
        autoAdvance: false,
    },

    // ── 5. Add a roundabout ───────────────────────────────────────────
    {
        id: "deselect",
        title: "Deselect the Intersection",
        description: "Click the ✕ button at the top of the Selection Panel to deselect the intersection before adding a new object.",
        target: "[data-action='deselect']",
        action: "click",
        position: "right",
        autoAdvance: true,
    },
    {
        id: "add-roundabout",
        title: "Add a Roundabout",
        description: "Click '+ Roundabout' in the Build Tools to place a new roundabout at the origin.",
        target: "[data-action='add-roundabout']",
        action: "click",
        position: "bottom",
        autoAdvance: true,
    },

    // ── 6. Drag the roundabout ────────────────────────────────────────
    {
        id: "drag-roundabout",
        title: "Move the Roundabout",
        description: "Click and drag the roundabout to position it to the right of the intersection, so their exits can face each other.",
        target: "canvas",
        action: "drag",
        position: "top",
        autoAdvance: false,
    },

    // ── 7. Create a link ──────────────────────────────────────────────
    {
        id: "select-first-exit",
        title: "Select the First Exit",
        description: "Click on the exit of the intersection that faces the roundabout. A red highlight will appear on the selected exit.",
        target: "canvas",
        action: "click",
        position: "top",
        autoAdvance: true,
    },
    {
        id: "select-second-exit",
        title: "Select the Second Exit",
        description: "Now click on the facing exit of the roundabout. With two exits selected, a 'Link Exits' button will appear.",
        target: "canvas",
        action: "click",
        position: "top",
        autoAdvance: true,
    },
    {
        id: "link-exits",
        title: "Link the Exits",
        description: "Click the 'Link Exits' button to create a road connecting the two selected exits.",
        target: "[data-action='link-exits']",
        action: "click",
        position: "bottom",
        autoAdvance: true,
    },

    // ── 8. Confirm config ─────────────────────────────────────────────
    {
        id: "confirm-config",
        title: "Confirm Configuration",
        description: "Click the ✓ (checkmark) button in the header to approve your junction layout. This locks the layout and enables simulation controls.",
        target: "[data-action='confirm-config']",
        action: "click",
        position: "bottom",
        autoAdvance: true,
    },

    // ── 9. Customise simulation config ────────────────────────────────
    {
        id: "open-sim-config",
        title: "Open Simulation Config",
        description: "Click the 'Sim Config' tab in the header to review and customise simulation parameters like spawn rate, vehicle speed, and controller timings.",
        target: "[data-menu-id='config']",
        action: "click",
        position: "bottom",
        autoAdvance: true,
    },
    {
        id: "explore-sim-config",
        title: "Customise Simulation Settings",
        description: "Adjust any parameters you like — spawn rate, max vehicles, preferred speed, car class weights, and more. Close the menu when you're happy.",
        target: "[data-dropdown-panel]",
        action: "interact",
        position: "top",
        autoAdvance: false,
    },

    // ── 10. Play the simulation ───────────────────────────────────────
    {
        id: "close-sim-config",
        title: "Close the Config Menu",
        description: "Click the 'Sim Config' tab again (or click the backdrop) to close the dropdown.",
        target: "[data-menu-id='config']",
        action: "click",
        position: "bottom",
        autoAdvance: true,
    },
    {
        id: "play-simulation",
        title: "Start the Simulation",
        description: "Click the ▶ (play) button in the header to start the traffic simulation. Vehicles will begin spawning and driving through your junction network!",
        target: "[data-action='play-sim']",
        action: "click",
        position: "bottom",
        autoAdvance: true,
    },

    // ── 11. Stop the simulation ───────────────────────────────────────
    {
        id: "stop-simulation",
        title: "Stop the Simulation",
        description: "Let the simulation run for a few seconds, then click the ■ (stop) button to halt it. Statistics are preserved after stopping.",
        target: "[data-action='stop-sim']",
        action: "click",
        position: "bottom",
        autoAdvance: true,
    },

    // ── 12. Download a save file ──────────────────────────────────────
    {
        id: "download-save",
        title: "Download a Save File",
        description: "Click the ↓ (download) button to save your junction layout and simulation config as a JSON file. You can load this later to restore your work.",
        target: "[data-action='download-save']",
        action: "click",
        position: "bottom",
        autoAdvance: true,
    },

    // ── 13. Download a report ─────────────────────────────────────────
    {
        id: "download-report",
        title: "Download a Report",
        description: "Click the 📄 (report) button to generate a PDF report of your junction, including the diagram, configuration, and simulation statistics.",
        target: "[data-action='download-report']",
        action: "click",
        position: "bottom",
        autoAdvance: true,
    },

    // ── Done ──────────────────────────────────────────────────────────
    {
        id: "tutorial-complete",
        title: "Tutorial Complete!",
        description: "You've built and simulated your first junction network. Feel free to experiment — add more junctions, tweak the simulation config, or start a fresh layout.",
        target: "",
        action: "none",
        position: "top-right",
        autoAdvance: false,
        nextLabel: "Finish",
    },];