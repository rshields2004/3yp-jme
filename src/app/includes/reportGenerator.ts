/**
 * reportGenerator.ts
 *
 * Generates a multi-page PDF report (dark themed) for a junction simulation
 * using jsPDF. Includes a junction diagram, full configuration tables, and
 * aggregated simulation statistics.
 */

import jsPDF from "jspdf";
import { JunctionConfig } from "./types/types";
import { SimConfig, SimulationStats } from "./types/simulation";
import { PDF_PAGE_WIDTH, PDF_PAGE_HEIGHT, PDF_MARGIN, PDF_CONTENT_WIDTH, COLOURS } from "./constants";

// HELPERS

/**
 * Set the PDF fill colour from an RGB tuple.
 *
 * @param pdf - the jsPDF document instance
 * @param rgb - RGB colour tuple
 */
const setFill = (pdf: jsPDF, rgb: readonly [number, number, number]) => {
    pdf.setFillColor(rgb[0], rgb[1], rgb[2]);
}
/**
 * Set the PDF draw (stroke) colour from an RGB tuple.
 *
 * @param pdf - the jsPDF document instance
 * @param rgb - RGB colour tuple
 */
const setDraw = (pdf: jsPDF, rgb: readonly [number, number, number]) => {
    pdf.setDrawColor(rgb[0], rgb[1], rgb[2]);
}
/**
 * Set the PDF text colour from an RGB tuple.
 *
 * @param pdf - the jsPDF document instance
 * @param rgb - RGB colour tuple
 */
const setTextColor = (pdf: jsPDF, rgb: readonly [number, number, number]) => {
    pdf.setTextColor(rgb[0], rgb[1], rgb[2]);
}

/**
 * Fill the entire page with the dark background colour.
 *
 * @param pdf - the jsPDF document instance
 */
const pageBackground = (pdf: jsPDF) => {
    setFill(pdf, COLOURS.bg);
    pdf.rect(0, 0, PDF_PAGE_WIDTH, PDF_PAGE_HEIGHT, "F");
}

/**
 * Thin horizontal rule (optionally scoped to a column)
 *
 * @param pdf - the jsPDF document instance
 * @param y - y-coordinate
 * @param x0 - left x-coordinate
 * @param x1 - right x-coordinate
 */
const hRule = (pdf: jsPDF, y: number, x0 = PDF_MARGIN, x1 = PDF_PAGE_WIDTH - PDF_MARGIN) => {
    setDraw(pdf, COLOURS.border);
    pdf.setLineWidth(0.25);
    pdf.line(x0, y, x1, y);
}

/**
 * Page header band
 *
 * @param pdf - the jsPDF document instance
 * @param title - title text
 * @param subtitle - subtitle text
 * @param pageNum - current page number
 * @param totalPages - total number of pages
 */
const pageHeader = (pdf: jsPDF, title: string, subtitle: string, pageNum: number, totalPages = 3) => {
    // Top bar
    setFill(pdf, COLOURS.surface);
    pdf.rect(0, 0, PDF_PAGE_WIDTH, 18, "F");
    setFill(pdf, COLOURS.accent);
    pdf.rect(0, 0, 3, 18, "F");

    // Title
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(10);
    setTextColor(pdf, COLOURS.white);
    pdf.text("JME", PDF_MARGIN + 1, 11.5);

    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    setTextColor(pdf, COLOURS.dimText);
    pdf.text("Junction Modeller Expanded", PDF_MARGIN + 11, 11.5);

    // Section title centred
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(9);
    setTextColor(pdf, COLOURS.text);
    pdf.text(title, PDF_PAGE_WIDTH / 2, 11.5, { align: "center" });

    // Right: page number
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    setTextColor(pdf, COLOURS.muted);
    pdf.text(`Page ${pageNum} / ${totalPages}`, PDF_PAGE_WIDTH - PDF_MARGIN, 11.5, { align: "right" });

    // Subtitle below bar
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(7.5);
    setTextColor(pdf, COLOURS.muted);
    pdf.text(subtitle, PDF_MARGIN, 25);
}

/**
 * Render an uppercase section heading with a horizontal rule underneath.
 *
 * @param pdf - the jsPDF document instance
 * @param text - display text
 * @param y - y-coordinate
 * @param x - x-coordinate
 * @param w - width
 * @returns the updated y-coordinate
 */
const sectionLabel = (pdf: jsPDF, text: string, y: number, x = PDF_MARGIN, w = PDF_CONTENT_WIDTH): number => {
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(7);
    setTextColor(pdf, COLOURS.accent);
    pdf.text(text.toUpperCase(), x, y);
    hRule(pdf, y + 2, x, x + w);
    return y + 7;
}

/**
 * Render a labelled key-value row, optionally highlighted with a filled surface background.
 *
 * @param pdf - the jsPDF document instance
 * @param label - label text
 * @param value - display value
 * @param x - x-coordinate
 * @param y - y-coordinate
 * @param colWidth - column width in mm
 * @param highlight - whether to apply highlight styling
 * @returns the updated y-coordinate
 */
const kvRow = (
    pdf: jsPDF,
    label: string,
    value: string,
    x: number,
    y: number,
    colWidth: number,
    highlight = false
): number => {
    const ROW_H = 5.5;
    if (highlight) {
        setFill(pdf, COLOURS.surface);
        pdf.rect(x, y - 3.5, colWidth, ROW_H, "F");
    }
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(7.5);
    setTextColor(pdf, COLOURS.dimText);
    pdf.text(label, x + 2, y);
    pdf.setFont("helvetica", "bold");
    setTextColor(pdf, COLOURS.text);
    pdf.text(value, x + colWidth - 2, y, { align: "right" });
    return y + ROW_H;
}

// PAGE 1 - JUNCTION DIAGRAM

/**
 * Render the junction layout onto an off-screen canvas and return the result as a data-URL PNG.
 *
 * @param junction - the junction configuration
 * @returns the diagram as a data-URL PNG string
 */
const drawJunctionDiagram = (junction: JunctionConfig): string => {
    const CW = 2400;
    const CH = 1520;
    const canvas = document.createElement("canvas");
    canvas.width = CW;
    canvas.height = CH;
    const ctx = canvas.getContext("2d")!;

    // Background
    ctx.fillStyle = "#09090b";
    ctx.fillRect(0, 0, CW, CH);

    // Subtle grid
    ctx.strokeStyle = "rgba(63,63,70,0.35)";
    ctx.lineWidth = 1;
    const GRID = 80;
    for (let gx = 0; gx < CW; gx += GRID) { ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, CH); ctx.stroke(); }
    for (let gy = 0; gy < CH; gy += GRID) { ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(CW, gy); ctx.stroke(); }

    const objects = junction.junctionObjects.filter(o => o.transform);
    if (objects.length === 0) {
        ctx.fillStyle = "#71717a";
        ctx.font = "bold 48px monospace";
        ctx.textAlign = "center";
        ctx.fillText("No positioned objects", CW / 2, CH / 2);
        return canvas.toDataURL("image/png");
    }

    // Compute bounds - account for the rendered extent of each object
    // (body radius + arm length + label bubble) so arms don't overflow.
    const xs = objects.map(o => o.transform!.position.x);
    const zs = objects.map(o => o.transform!.position.z);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minZ = Math.min(...zs), maxZ = Math.max(...zs);

    // Estimate max world-space "radius" of an object (arm + label extend).
    // baseR ≈ maxExit * scale * 0.28, len ≈ exitLength * scale * 0.5
    // Total px from centre = (maxExit * 0.28 + exitLength * 0.5) * scale + 26 + 40 (minimums+label)
    // In world units that's (maxExit * 0.28 + exitLength * 0.5) + 66/scale.
    // Since we don't know scale yet, compute the linear factor and solve:
    //   Available = canvasSize - 2 * constantPad
    //   scale = Available / (span + 2 * linearExtent)
    const maxExitLen = Math.max(...objects.flatMap(o => o.config.exitConfig.map(e => e.exitLength)), 20);
    const linearExtent = maxExitLen * 0.28 + maxExitLen * 0.5; // world-space contribution per side
    const FIXED_PAD = 100; // constant-pixel pad for labels/bubbles

    const spanX = Math.max(maxX - minX, 1);
    const spanZ = Math.max(maxZ - minZ, 1);
    const scale = Math.min(
        (CW - FIXED_PAD * 2) / (spanX + 2 * linearExtent),
        (CH - FIXED_PAD * 2) / (spanZ + 2 * linearExtent),
        28
    );

    const toC = (x: number, z: number) => ({
        cx: CW / 2 + (x - (minX + maxX) / 2) * scale,
        cy: CH / 2 + (z - (minZ + maxZ) / 2) * scale,
    });

    // Helper: compute the canvas-space tip position of an exit arm
    const exitTip = (obj: typeof objects[0], exitIndex: number) => {
        const { cx, cy } = toC(obj.transform!.position.x, obj.transform!.position.z);
        const maxExit = Math.max(...obj.config.exitConfig.map(e => e.exitLength));
        const baseR = Math.max(40, maxExit * scale * 0.28);
        const numExits = obj.config.numExits;
        const exitCfg = obj.config.exitConfig[exitIndex];
        let angle: number;
        if (obj.type === "roundabout") {
            angle = (exitIndex / numExits) * Math.PI * 2;
        } else {
            angle = (exitIndex / numExits) * Math.PI * 2 - Math.PI / 2;
        }
        const len = Math.max(30, (exitCfg?.exitLength ?? 20) * scale * 0.5);
        return {
            x: cx + Math.cos(angle) * (baseR + len),
            y: cy + Math.sin(angle) * (baseR + len),
            dx: Math.cos(angle),
            dy: Math.sin(angle),
        };
    };

        // Draw links (exit-to-exit with bezier curves)
    // Bezier helpers for offset lane lines
    const bezPt = (t: number, p0: number, c1: number, c2: number, p3: number) => {
        const u = 1 - t;
        return u*u*u*p0 + 3*u*u*t*c1 + 3*u*t*t*c2 + t*t*t*p3;
    };
    const bezTan = (t: number, p0: number, c1: number, c2: number, p3: number) => {
        const u = 1 - t;
        return 3*u*u*(c1-p0) + 6*u*t*(c2-c1) + 3*t*t*(p3-c2);
    };
    const LINK_SAMPLES = 40;

    for (const link of junction.junctionLinks) {
        const oA = objects.find(o => o.id === link.objectPair[0].structureID);
        const oB = objects.find(o => o.id === link.objectPair[1].structureID);
        if (!oA?.transform || !oB?.transform) continue;

        const tipA = exitTip(oA, link.objectPair[0].exitIndex);
        const tipB = exitTip(oB, link.objectPair[1].exitIndex);
        const exitCfgA = oA.config.exitConfig[link.objectPair[0].exitIndex];
        const lc = exitCfgA?.laneCount ?? 2;
        const numLanesInLink = exitCfgA?.numLanesIn ?? 1;
        const rw = Math.max(8, lc * junction.laneWidth * scale);
        const lwScaled = junction.laneWidth * scale;
        const totalW = lc * lwScaled;

        // Control point distance for a smooth bezier
        const dist = Math.hypot(tipB.x - tipA.x, tipB.y - tipA.y);
        const cp = dist * 0.35;
        const c1x = tipA.x + tipA.dx * cp, c1y = tipA.y + tipA.dy * cp;
        const c2x = tipB.x + tipB.dx * cp, c2y = tipB.y + tipB.dy * cp;

        // Road surface
        ctx.strokeStyle = "#27272a";
        ctx.lineWidth = rw;
        ctx.lineCap = "butt";
        ctx.beginPath();
        ctx.moveTo(tipA.x, tipA.y);
        ctx.bezierCurveTo(c1x, c1y, c2x, c2y, tipB.x, tipB.y);
        ctx.stroke();

        // Draw an offset lane line by sampling the bezier
        const drawOffsetBezier = (off: number, style: string, width: number, dash: number[]) => {
            ctx.strokeStyle = style;
            ctx.lineWidth = width;
            ctx.setLineDash(dash);
            ctx.beginPath();
            for (let s = 0; s <= LINK_SAMPLES; s++) {
                const t = s / LINK_SAMPLES;
                const px = bezPt(t, tipA.x, c1x, c2x, tipB.x);
                const py = bezPt(t, tipA.y, c1y, c2y, tipB.y);
                const tx = bezTan(t, tipA.x, c1x, c2x, tipB.x);
                const ty = bezTan(t, tipA.y, c1y, c2y, tipB.y);
                const tlen = Math.hypot(tx, ty) || 1;
                const nx = -ty / tlen, ny = tx / tlen;
                const ox = px + nx * off, oy = py + ny * off;
                s === 0 ? ctx.moveTo(ox, oy) : ctx.lineTo(ox, oy);
            }
            ctx.stroke();
            ctx.setLineDash([]);
        };

        // Edge lines
        drawOffsetBezier(-totalW / 2, "#52525b", 2, []);
        drawOffsetBezier(totalW / 2, "#52525b", 2, []);

        // Internal lane dividers
        for (let k = 1; k < lc; k++) {
            const off = -totalW / 2 + k * lwScaled;
            const isSolid = k === numLanesInLink;
            drawOffsetBezier(
                off,
                isSolid ? "rgba(255,255,255,0.7)" : "rgba(255,255,255,0.35)",
                isSolid ? 2.5 : 1.5,
                isSolid ? [] : [12, 12]
            );
        }
    }

        // Draw objects
    for (const obj of objects) {
        const { cx, cy } = toC(obj.transform!.position.x, obj.transform!.position.z);
        const maxExit = Math.max(...obj.config.exitConfig.map(e => e.exitLength));
        const baseR = Math.max(40, maxExit * scale * 0.28);
        const numExits = obj.config.numExits;

        // For each exit: draw arm first (behind body)
        for (let ei = 0; ei < numExits; ei++) {
            const exitCfg = obj.config.exitConfig[ei];
            let angle: number;
            if (obj.type === "roundabout") {
                angle = (ei / numExits) * Math.PI * 2;
            } else {
                angle = (ei / numExits) * Math.PI * 2 - Math.PI / 2;
            }

            const lc = exitCfg?.laneCount ?? 2;
            const len = Math.max(30, (exitCfg?.exitLength ?? 20) * scale * 0.5);
            const rw = Math.max(8, lc * junction.laneWidth * scale);

            const ex = cx + Math.cos(angle) * (baseR + len);
            const ey = cy + Math.sin(angle) * (baseR + len);

            // Arm surface
            ctx.strokeStyle = "#27272a";
            ctx.lineWidth = rw;
            ctx.lineCap = "butt";
            ctx.beginPath();
            ctx.moveTo(cx + Math.cos(angle) * baseR * 0.9, cy + Math.sin(angle) * baseR * 0.9);
            ctx.lineTo(ex, ey);
            ctx.stroke();

            // Lane markings on arm
            const perpX = -Math.sin(angle), perpY = Math.cos(angle);
            const lwScaled = junction.laneWidth * scale;
            const totalW = lc * lwScaled;
            const armSx = cx + Math.cos(angle) * baseR * 0.9;
            const armSy = cy + Math.sin(angle) * baseR * 0.9;
            const numLanesIn = exitCfg?.numLanesIn ?? 1;

            // Edge lines
            for (const k of [0, lc]) {
                const off = -totalW / 2 + k * lwScaled;
                ctx.strokeStyle = "#52525b";
                ctx.lineWidth = 2;
                ctx.setLineDash([]);
                ctx.beginPath();
                ctx.moveTo(armSx + perpX * off, armSy + perpY * off);
                ctx.lineTo(ex + perpX * off, ey + perpY * off);
                ctx.stroke();
            }

            // Internal lane dividers
            for (let k = 1; k < lc; k++) {
                const off = -totalW / 2 + k * lwScaled;
                const isSolid = k === numLanesIn;
                ctx.strokeStyle = isSolid ? "rgba(255,255,255,0.7)" : "rgba(255,255,255,0.35)";
                ctx.lineWidth = isSolid ? 2.5 : 1.5;
                ctx.setLineDash(isSolid ? [] : [12, 12]);
                ctx.beginPath();
                ctx.moveTo(armSx + perpX * off, armSy + perpY * off);
                ctx.lineTo(ex + perpX * off, ey + perpY * off);
                ctx.stroke();
            }
            ctx.setLineDash([]);

            // Stop line
            const halfW = (rw / 2) + 2;
            ctx.strokeStyle = "#ffffff";
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(cx + Math.cos(angle) * baseR + perpX * halfW, cy + Math.sin(angle) * baseR + perpY * halfW);
            ctx.lineTo(cx + Math.cos(angle) * baseR - perpX * halfW, cy + Math.sin(angle) * baseR - perpY * halfW);
            ctx.stroke();

            // Exit label bubble
            const lblR = baseR + len + 26;
            const lblX = cx + Math.cos(angle) * lblR;
            const lblY = cy + Math.sin(angle) * lblR;
            ctx.fillStyle = "rgba(99,102,241,0.85)";
            ctx.beginPath(); ctx.arc(lblX, lblY, 18, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = "#ffffff";
            ctx.font = "bold 18px monospace";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(`${ei}`, lblX, lblY);
        }

        // Body
        if (obj.type === "roundabout") {
            // Outer ring
            ctx.fillStyle = "#27272a";
            ctx.strokeStyle = "#71717a";
            ctx.lineWidth = 3;
            ctx.beginPath(); ctx.arc(cx, cy, baseR, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
            // Island
            ctx.fillStyle = "#3f3f46";
            ctx.beginPath(); ctx.arc(cx, cy, baseR * 0.38, 0, Math.PI * 2); ctx.fill();
        } else {
            // Polygon
            ctx.fillStyle = "#27272a";
            ctx.strokeStyle = "#71717a";
            ctx.lineWidth = 3;
            ctx.beginPath();
            for (let i = 0; i < numExits; i++) {
                const a = (i / numExits) * Math.PI * 2 - Math.PI / 2;
                const px = cx + Math.cos(a) * baseR * 0.72;
                const py = cy + Math.sin(a) * baseR * 0.72;
                i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
            }
            ctx.closePath(); ctx.fill(); ctx.stroke();
        }

        // Object label
        const tag = obj.type === "roundabout" ? "RBT" : "INT";
        ctx.font = "bold 20px monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        setCanvasShadow(ctx, "rgba(0,0,0,0.8)", 4);
        ctx.fillStyle = "#ffffff";
        ctx.fillText(`${tag} ${obj.name}`, cx, cy - 5);
        ctx.font = "14px monospace";
        ctx.fillStyle = "#a1a1aa";
        ctx.fillText(`${numExits} exits`, cx, cy + 14);
        clearCanvasShadow(ctx);
    }

    // Legend
    const lx = 40, ly = CH - 120;
    ctx.fillStyle = "rgba(24,24,27,0.9)";
    roundRect(ctx, lx - 10, ly - 14, 280, 100, 8);
    ctx.fillStyle = "#a1a1aa";
    ctx.font = "bold 14px monospace";
    ctx.textAlign = "left";
    ctx.fillText("LEGEND", lx, ly);
    ctx.font = "13px monospace";
    // INT sample
    ctx.fillStyle = "#4f4f57"; ctx.fillRect(lx, ly + 10, 20, 12);
    ctx.fillStyle = "#e4e4e7"; ctx.fillText("Intersection (INT)", lx + 26, ly + 21);
    // RBT sample
    ctx.strokeStyle = "#71717a"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(lx + 10, ly + 42, 8, 0, Math.PI * 2); ctx.fillStyle = "#27272a"; ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#e4e4e7"; ctx.fillText("Roundabout (RBT)", lx + 26, ly + 45);
    // Exit label sample
    ctx.fillStyle = "rgba(99,102,241,0.85)";
    ctx.beginPath(); ctx.arc(lx + 10, ly + 68, 8, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#ffffff"; ctx.font = "bold 12px monospace"; ctx.textAlign = "center";
    ctx.fillText("0", lx + 10, ly + 72);
    ctx.textAlign = "left"; ctx.font = "13px monospace";
    ctx.fillStyle = "#e4e4e7"; ctx.fillText("Exit Index", lx + 26, ly + 72);

    return canvas.toDataURL("image/png");
}

/**
 * Apply a drop-shadow to subsequent canvas draw calls.
 *
 * @param ctx - the canvas 2D rendering context
 * @param color - CSS colour string
 * @param blur - blur radius in pixels
 */
const setCanvasShadow = (ctx: CanvasRenderingContext2D, color: string, blur: number) => {
    ctx.shadowColor = color;
    ctx.shadowBlur = blur;
}
/**
 * Clear any active canvas shadow.
 *
 * @param ctx - the canvas 2D rendering context
 */
const clearCanvasShadow = (ctx: CanvasRenderingContext2D) => {
    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;
}
/**
 * Draw a filled rounded rectangle with the given corner radius.
 *
 * @param ctx - the canvas 2D rendering context
 * @param x - x-coordinate
 * @param y - y-coordinate
 * @param w - width
 * @param h - height
 * @param r - corner radius
 */
const roundRect = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) => {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
    ctx.fill();
}

// PAGE 2 - JUNCTION AND SIM CONFIG

/**
 * Build the configuration page: global settings, per-object tables, link details, and simulation parameters.
 *
 * @param pdf - the jsPDF document instance
 * @param junction - the junction configuration
 * @param simConfig - the simulation configuration
 * @param startPage - starting page number
 * @param totalPages - total number of pages
 * @returns the final page number used
 */
const buildConfigPage = (pdf: jsPDF, junction: JunctionConfig, simConfig: SimConfig, startPage: number, totalPages: number): number => {
    pageBackground(pdf);
    pageHeader(pdf, "Configuration", `Generated ${new Date().toLocaleString()} · ${junction.junctionObjects.length} object(s) · ${junction.junctionLinks.length} link(s)`, startPage, totalPages);

    const TOP = 30;
    const COL_W = (PDF_CONTENT_WIDTH - 6) / 3;   // 3 equal columns
    const cols = [PDF_MARGIN, PDF_MARGIN + COL_W + 3, PDF_MARGIN + (COL_W + 3) * 2];
    let currentPage = startPage;

    // Column 1: Global + Junction Objects
    let y = TOP;
    y = sectionLabel(pdf, "Global Settings", y, cols[0], COL_W);
    const even = [true, false];
    let idx = 0;
    const global: [string, string][] = [
        ["Lane Width", `${junction.laneWidth} wu`],
        ["Objects", `${junction.junctionObjects.length}`],
        ["Links", `${junction.junctionLinks.length}`],
    ];
    for (const [k, v] of global) {
        y = kvRow(pdf, k, v, cols[0], y, COL_W, even[idx++ % 2]);
    }

    y += 4;
    y = sectionLabel(pdf, "Junction Objects", y, cols[0], COL_W);

    for (let oi = 0; oi < junction.junctionObjects.length; oi++) {
        const obj = junction.junctionObjects[oi];

        // Pre-calculate height for this object to check overflow BEFORE drawing
        const objHeight = 5.5 + 2 * 5.5 + obj.config.exitConfig.length * 5.5 + 3;
        if (y + objHeight > PDF_PAGE_HEIGHT - 20) {
            pdf.addPage();
            currentPage++;
            pageBackground(pdf);
            pageHeader(pdf, "Configuration (cont.)", `Junction Objects continued`, currentPage, totalPages);
            y = TOP;
            y = sectionLabel(pdf, "Junction Objects (cont.)", y, cols[0], COL_W);
        }

        // Object header chip
        setFill(pdf, obj.type === "roundabout" ? [30, 50, 40] : [30, 35, 55]);
        pdf.rect(cols[0], y - 3.5, COL_W, 5.5, "F");
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(7.5);
        setTextColor(pdf, COLOURS.white);
        const tag = obj.type === "roundabout" ? "RBT" : "INT";
        pdf.text(`${tag} ${obj.name}  -  ${obj.config.numExits} exits`, cols[0] + 2, y);
        y += 5.5;

        let ri = 0;
        y = kvRow(pdf, "Type", obj.type, cols[0], y, COL_W, ri++ % 2 === 0);
        y = kvRow(pdf, "Exits", `${obj.config.numExits}`, cols[0], y, COL_W, ri++ % 2 === 0);
        // Per-exit summary (compact)
        for (let ei = 0; ei < obj.config.exitConfig.length; ei++) {
            const ec = obj.config.exitConfig[ei];
            const spawn = ec.spawnRate != null ? `${ec.spawnRate.toFixed(2)} v/s` : "global";
            y = kvRow(pdf,
                `  Exit ${ei}`,
                `${ec.laneCount} lanes (${ec.numLanesIn} in) · ${ec.exitLength}wu · ${spawn}`,
                cols[0], y, COL_W, ri++ % 2 === 0);
        }
        y += 3;
    }

    // Columns 2 & 3 always render on the first config page
    const firstConfigPageIdx = startPage;  // 1-based page number
    // jsPDF pages are 1-indexed; switch back to the first config page
    pdf.setPage(firstConfigPageIdx);

    // Column 2: Spawning + Motion + Spacing
    y = TOP;
    y = sectionLabel(pdf, "Spawning", y, cols[1], COL_W);
    const sp = simConfig.spawning;
    const spRows: [string, string][] = [
        ["Spawn Rate", `${sp.spawnRate.toFixed(2)} v/s`],
        ["Max Vehicles", `${sp.maxVehicles}`],
        ["Max Attempts", `${sp.maxSpawnAttemptsPerFrame}`],
        ["Max Queue", `${sp.maxSpawnQueue}`],
        ["Seed", simConfig.simSeed],
    ];
    idx = 0;
    for (const [k, v] of spRows) y = kvRow(pdf, k, v, cols[1], y, COL_W, idx++ % 2 === 0);

    y += 4;
    y = sectionLabel(pdf, "Motion", y, cols[1], COL_W);
    const mo = simConfig.motion;
    const moRows: [string, string][] = [
        ["Initial Speed", `${mo.initialSpeed.toFixed(1)} m/s`],
        ["Preferred Speed", `${mo.preferredSpeed.toFixed(1)} m/s`],
        ["Max Accel", `${mo.maxAccel.toFixed(1)} m/s²`],
        ["Max Decel", `${mo.maxDecel.toFixed(1)} m/s²`],
        ["Comfort Decel", `${mo.comfortDecel.toFixed(1)} m/s²`],
    ];
    idx = 0;
    for (const [k, v] of moRows) y = kvRow(pdf, k, v, cols[1], y, COL_W, idx++ % 2 === 0);

    y += 4;
    y = sectionLabel(pdf, "Spacing", y, cols[1], COL_W);
    const sc = simConfig.spacing;
    const scRows: [string, string][] = [
        ["Min Bumper Gap", `${sc.minBumperGap.toFixed(2)} wu`],
        ["Time Headway", `${sc.timeHeadway.toFixed(2)} s`],
        ["Stop Line Offset", `${sc.stopLineOffset.toFixed(3)}`],
    ];
    idx = 0;
    for (const [k, v] of scRows) y = kvRow(pdf, k, v, cols[1], y, COL_W, idx++ % 2 === 0);

    // Column 3: Controllers + Car Classes
    y = TOP;
    y = sectionLabel(pdf, "Intersection Controller", y, cols[2], COL_W);
    const ic = simConfig.controllers.intersection;
    const icRows: [string, string][] = [
        ["Green Time", `${ic.intersectionGreenTime.toFixed(1)} s`],
        ["Amber Time", `${ic.intersectionAmberTime.toFixed(1)} s`],
        ["Red-Amber Time", `${ic.intersectionRedAmberTime.toFixed(1)} s`],
        ["All-Red Time", `${ic.intersectionAllRedTime.toFixed(1)} s`],
    ];
    idx = 0;
    for (const [k, v] of icRows) y = kvRow(pdf, k, v, cols[2], y, COL_W, idx++ % 2 === 0);

    y += 4;
    y = sectionLabel(pdf, "Roundabout Controller", y, cols[2], COL_W);
    const rc = simConfig.controllers.roundabout;
    const rcRows: [string, string][] = [
        ["Min Gap", `${rc.roundaboutMinGap.toFixed(1)} wu`],
        ["Min Time Gap", `${rc.roundaboutMinTimeGap.toFixed(1)} s`],
        ["Safe Entry Dist", `${rc.roundaboutSafeEntryDist.toFixed(0)} wu`],
        ["Entry Timeout", `${rc.roundaboutEntryTimeout.toFixed(1)} s`],
        ["Min Angular Sep", `${Math.round(rc.roundaboutMinAngularSep * 180 / Math.PI)}°`],
    ];
    idx = 0;
    for (const [k, v] of rcRows) y = kvRow(pdf, k, v, cols[2], y, COL_W, idx++ % 2 === 0);

    y += 4;
    y = sectionLabel(pdf, "Car Classes", y, cols[2], COL_W);
    // Table header
    const CC_COLS = [3, 31, 49, 66, 83];  // offsets within col 3 (3mm left pad)
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(6.5);
    setTextColor(pdf, COLOURS.muted);
    ["Class", "Speed", "Accel", "Decel", "Wt"].forEach((h, i) => {
        pdf.text(h, cols[2] + CC_COLS[i], y);
    });
    y += 2;
    hRule(pdf, y, cols[2], cols[2] + COL_W); y += 3;

    const enabled = simConfig.rendering.enabledCarClasses;
    for (const [bt, ovr] of Object.entries(simConfig.carClassOverrides)) {
        const on = enabled.includes(bt);
        setFill(pdf, on ? COLOURS.surface : COLOURS.bg);
        pdf.rect(cols[2], y - 3.5, COL_W, 5, "F");
        pdf.setFont("helvetica", on ? "normal" : "italic");
        pdf.setFontSize(6.5);
        setTextColor(pdf, on ? COLOURS.text : COLOURS.muted);

        const vals = [bt, `${ovr.speedFactor.toFixed(2)}x`, `${ovr.accelFactor.toFixed(2)}x`, `${ovr.decelFactor.toFixed(2)}x`, `${ovr.weight}`];
        vals.forEach((v, i) => pdf.text(v, cols[2] + CC_COLS[i], y));
        y += 5;
        if (y > PDF_PAGE_HEIGHT - 12) break;
    }

    // Navigate back to the last page so subsequent addPage() calls work correctly
    if (currentPage > firstConfigPageIdx) {
        pdf.setPage(currentPage);
    }
    return currentPage;
}

// PAGE 3 - SIMULATION STATS

/**
 * Build the statistics page: summary tiles, per-link throughput / wait-time tables, and object stats.
 *
 * @param pdf - the jsPDF document instance
 * @param stats - aggregated simulation statistics
 * @param junction - the junction configuration
 * @param pageNum - current page number
 * @param totalPages - total number of pages
 */
const buildStatsPage = (pdf: jsPDF, stats: SimulationStats, junction: JunctionConfig, pageNum: number, totalPages: number) => {
    pageBackground(pdf);
    pageHeader(pdf, "Simulation Summary",
        `Elapsed: ${stats.elapsedTime.toFixed(1)} s · Spawned: ${stats.spawned} · Completed: ${stats.completed}`, pageNum, totalPages);

    const TOP = 30;
    const HALF = (PDF_CONTENT_WIDTH - 4) / 2;
    const col2 = PDF_MARGIN + HALF + 4;

    // Left: Summary overview (big stat tiles)
    let y = TOP;
    y = sectionLabel(pdf, "Simulation Overview", y, PDF_MARGIN, HALF);

    const bigStats: [string, string, string][] = [
        ["Total Spawned", `${stats.spawned}`, "#a3e635"],
        ["Trips Completed", `${stats.completed}`, "#34d399"],
        ["Elapsed Time", `${stats.elapsedTime.toFixed(1)} s`, "#94a3b8"],
        ["Avg Speed", `${stats.avgSpeed.toFixed(1)} m/s`, "#818cf8"],
        ["Avg Travel Time", `${stats.avgTravelTime.toFixed(1)} s`, "#fbbf24"],
        ["Routes Available", `${stats.routes}`, "#e4e4e7"],
    ];

    const TILE_W = (HALF - 4) / 3;
    const TILE_H = 20;
    for (let i = 0; i < bigStats.length; i++) {
        const [label, value, colour] = bigStats[i];
        const tx = PDF_MARGIN + (i % 3) * (TILE_W + 2);
        const ty = y + Math.floor(i / 3) * (TILE_H + 2);
        setFill(pdf, COLOURS.surface);
        pdf.rect(tx, ty, TILE_W, TILE_H, "F");
        // Accent top bar
        const rgb = hexToRgb(colour);
        if (rgb) { setFill(pdf, rgb); pdf.rect(tx, ty, TILE_W, 1.5, "F"); }

        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(14);
        if (rgb) setTextColor(pdf, rgb); else setTextColor(pdf, COLOURS.white);
        pdf.text(value, tx + TILE_W / 2, ty + 11, { align: "center" });

        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(6.5);
        setTextColor(pdf, COLOURS.muted);
        pdf.text(label, tx + TILE_W / 2, ty + 17, { align: "center" });
    }
    y += (TILE_H + 2) * 2 + 6;

    // Left: Global junction aggregate (cumulative)
    y = sectionLabel(pdf, "All-Junction Aggregate", y, PDF_MARGIN, HALF);
    const g = stats.junctions.global;
    const gRows: [string, string][] = [
        ["Junctions Tracked", `${g.count}`],
        ["Total Entered", `${g.entered}`],
        ["Total Exited", `${g.exited}`],
        ["Throughput", `${g.throughput.toFixed(1)} v/min`],
        ["Avg Wait Time", `${g.avgWaitTime.toFixed(2)} s`],
        ["Peak Queue Length", `${g.maxQueueLength}`],
        ["Practical Reserve Capacity", `${g.prc.toFixed(1)}%`],
        ["Mean Max Queue", `${g.mmq.toFixed(1)}`],
    ];
    let ri = 0;
    for (const [k, v] of gRows) {
        y = kvRow(pdf, k, v, PDF_MARGIN, y, HALF, ri++ % 2 === 0);
    }

    // Right: Per-junction stats (cumulative)
    let yR = TOP;
    let currentPage = pageNum;
    yR = sectionLabel(pdf, "Per-Junction Breakdown", yR, col2, HALF);

    const jIds = Object.keys(stats.junctions.byId ?? {});
    if (jIds.length === 0) {
        pdf.setFont("helvetica", "italic");
        pdf.setFontSize(7.5);
        setTextColor(pdf, COLOURS.muted);
        pdf.text("No per-junction data recorded.", col2, yR + 4);
    }

    // Track whether we've overflowed to a full-width page
    let overflowed = false;
    let jCol = col2;
    let jWidth = HALF;

    for (const jid of jIds) {
        const js = stats.junctions.byId[jid];
        const obj = junction.junctionObjects.find(o => o.id === jid);

        // Overflow: start a new full-width page
        if (yR > PDF_PAGE_HEIGHT - 14) {
            pdf.addPage();
            currentPage++;
            pageBackground(pdf);
            pageHeader(pdf, "Simulation Summary (cont.)", `Per-Junction Breakdown continued`, currentPage, totalPages);
            yR = TOP;
            if (!overflowed) {
                overflowed = true;
                jCol = PDF_MARGIN;
                jWidth = PDF_CONTENT_WIDTH;
            }
            yR = sectionLabel(pdf, "Per-Junction Breakdown (cont.)", yR, jCol, jWidth);
        }

        // Header chip
        const chipColor: readonly [number, number, number] = js.type === "roundabout" ? [30, 50, 40] : [30, 35, 55];
        setFill(pdf, chipColor);
        pdf.rect(jCol, yR - 3.5, jWidth, 5.5, "F");
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(7.5);
        setTextColor(pdf, COLOURS.white);
        const tag = js.type === "roundabout" ? "RBT" : "INT";
        pdf.text(`${tag} ${obj?.name ?? jid.slice(0, 8)}`, jCol + 2, yR);

        // LOS pill
        const losColor = js.levelOfService === "-" ? COLOURS.muted
            : js.levelOfService <= "B" ? COLOURS.green
            : js.levelOfService <= "D" ? COLOURS.amber
            : [239, 68, 68] as const;
        setFill(pdf, losColor as readonly [number, number, number]);
        pdf.rect(jCol + jWidth - 28, yR - 3, 26, 4.5, "F");
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(5.5);
        setTextColor(pdf, js.levelOfService === "-" ? COLOURS.dimText : [0, 0, 0]);
        const losLabel = js.levelOfService === "-" ? "N/A" : `LOS ${js.levelOfService}`;
        pdf.text(losLabel, jCol + jWidth - 15, yR, { align: "center" });
        yR += 5.5;

        ri = 0;
        const jRows: [string, string][] = [
            ["Total Entered", `${js.entered}`],
            ["Total Exited", `${js.exited}`],
            ["Throughput", `${js.throughput.toFixed(1)} v/min`],
            ["Avg Wait Time", `${js.avgWaitTime.toFixed(2)} s`],
            ["Max Wait Time", `${js.maxWaitTime.toFixed(2)} s`],
            ["Peak Queue Length", `${js.maxQueueLength}`],
            ["Degree of Saturation", `${js.dos.toFixed(2)}`],
            ["Practical Reserve Capacity", `${js.prc.toFixed(1)}%`],
            ["Mean Max Queue", `${js.mmq.toFixed(1)}`],
        ];
        for (const [k, v] of jRows) {
            yR = kvRow(pdf, k, v, jCol, yR, jWidth, ri++ % 2 === 0);
        }
        yR += 4;
    }
}

/**
 * Parse a hex colour string (e.g. `"#ff8800"`) into an `[R, G, B]` tuple, or `null` on failure.
 *
 * @param hex - hex colour string (e.g. "#ff8800")
 * @returns the [R, G, B] tuple, or `null` on parse failure
 */
const hexToRgb = (hex: string): [number, number, number] | null => {
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
    return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : null;
}

// PUBLIC ENTRY POINT

/**
 * Builds and downloads a multi-page PDF report for the current junction.
 *
 * @param junction - The junction configuration (objects, links, lane width).
 * @param simConfig - The simulation configuration (spawning, motion, controllers).
 * @param stats - Aggregated statistics collected during the simulation run.
 * @returns void (triggers a browser download)
 */
export const generateReport = async (
    junction: JunctionConfig,
    simConfig: SimConfig,
    stats: SimulationStats,
): Promise<void> => {
    // Pre-calculate total pages: 1 (diagram) + config pages + stats pages
    // Estimate how many config pages are needed for junction objects
    const ROW_H = 5.5;
    const OBJ_HEADER = 5.5;
    const TOP = 30;
    const GLOBAL_ROWS = 3; // Lane Width, Objects, Links
    const SECTION_OVERHEAD = 11; // sectionLabel (7) + gap (4)
    let estY = TOP + 7 + GLOBAL_ROWS * ROW_H + SECTION_OVERHEAD;
    let extraConfigPages = 0;
    for (let i = 0; i < junction.junctionObjects.length; i++) {
        const obj = junction.junctionObjects[i];
        const objHeight = OBJ_HEADER + 2 * ROW_H + obj.config.exitConfig.length * ROW_H + 3;
        // Match buildConfigPage: overflow checked BEFORE drawing
        if (estY + objHeight > PDF_PAGE_HEIGHT - 20) {
            extraConfigPages++;
            estY = TOP + 7; // reset for new page (section label overhead)
        }
        estY += objHeight;
    }
    // Estimate stats overflow pages for per-junction breakdown
    const JUNCTION_BLOCK_H = 5.5 + 9 * ROW_H + 4; // chip + 9 rows + gap
    const jIds = Object.keys(stats.junctions.byId ?? {});
    let estStatsY = TOP + 7; // starts after section label
    let extraStatsPages = 0;
    for (const _jid of jIds) {
        // Match buildStatsPage: overflow checked before drawing based on current Y
        if (estStatsY > PDF_PAGE_HEIGHT - 14) {
            extraStatsPages++;
            estStatsY = TOP + 7;
        }
        estStatsY += JUNCTION_BLOCK_H;
    }
    const totalPages = 3 + extraConfigPages + extraStatsPages;

    const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });

    //  Page 1 
    pageBackground(pdf);
    pageHeader(pdf, "Junction Diagram",
        `${junction.junctionObjects.length} object(s) · ${junction.junctionLinks.length} link(s) · Lane width ${junction.laneWidth} wu`, 1, totalPages);

    const imgData = drawJunctionDiagram(junction);
    const IMG_Y = 22;
    const IMG_H = PDF_PAGE_HEIGHT - IMG_Y - PDF_MARGIN;
    const IMG_W = PDF_CONTENT_WIDTH;
    pdf.addImage(imgData, "PNG", PDF_MARGIN, IMG_Y, IMG_W, IMG_H);

    // Page 2 (+ overflow pages)
    pdf.addPage();
    const lastConfigPage = buildConfigPage(pdf, junction, simConfig, 2, totalPages);

    // Final Page - Stats
    pdf.addPage();
    buildStatsPage(pdf, stats, junction, lastConfigPage + 1, totalPages);

    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    pdf.save(`jme-report-${ts}.pdf`);
}