import { state } from './state.js';

export const canvas = document.getElementById('main-canvas');
export const ctx = canvas.getContext('2d');

const offCanvas = document.createElement('canvas');
const offCtx = offCanvas.getContext('2d', { willReadFrequently: true });

const brushCanvas = document.createElement('canvas');
const brushCtx = brushCanvas.getContext('2d', { willReadFrequently: true });

let isDrawingShape = false;
let startX = 0, startY = 0;
let currentX = 0, currentY = 0; 

let isPainting = false;
let isErasing = false;
let currentBrushPath = [];

let isDrawingSelection = false;

// NEW: Resize state variables
let isResizing = false;
let activeHandle = null; 
let resizeOriginal = null; 

// --- HELPER FUNCTIONS ---

function askForLabel() {
    return new Promise((resolve) => {
        const modal = document.getElementById('label-modal');
        const input = document.getElementById('label-input');
        const datalist = document.getElementById('category-list');
        const btnConfirm = document.getElementById('btn-confirm-label');
        const btnCancel = document.getElementById('btn-cancel-label');

        datalist.innerHTML = '';
        if (state.projectMetadata && state.projectMetadata.categories) {
            state.projectMetadata.categories.forEach(cat => {
                const option = document.createElement('option');
                option.value = cat;
                datalist.appendChild(option);
            });
        }

        modal.style.display = 'flex';
        input.value = '';
        input.focus();

        const cleanup = () => {
            modal.style.display = 'none';
            btnConfirm.removeEventListener('click', onConfirm);
            btnCancel.removeEventListener('click', onCancel);
        };

        const onConfirm = () => { cleanup(); resolve(input.value.trim()); };
        const onCancel = () => { cleanup(); resolve(null); };

        btnConfirm.addEventListener('click', onConfirm);
        btnCancel.addEventListener('click', onCancel);
    });
}

async function addNewCategoryAndSave(label) {
    if (!label || label.trim() === "") return;
    const cleanLabel = label.trim();
    if (state.projectMetadata.categories.includes(cleanLabel)) return;

    state.projectMetadata.categories.push(cleanLabel);
    if (state.projectHandle) {
        try {
            await state.projectHandle.getDirectoryHandle(cleanLabel, { create: true });
            const dlaHandle = await state.projectHandle.getFileHandle('metadata.dla', { create: true });
            const writable = await dlaHandle.createWritable();
            await writable.write(JSON.stringify(state.projectMetadata));
            await writable.close();

            const projectTree = document.getElementById('project-tree');
            if (projectTree) {
                projectTree.innerHTML = `<b>Folder:</b> ${state.projectHandle.name}<br><br><b>Categories:</b><br>` + 
                    state.projectMetadata.categories.join('<br>');
            }
        } catch (error) { console.error("Error saving new category:", error); }
    }
}


// NEW HELPER: Get uniform Bounding Box for any shape/brush
function getBounds(ann) {
    if (ann.type === 'rectangle') return { x: ann.x, y: ann.y, w: ann.w, h: ann.h };
    if (ann.type === 'circle') return { x: ann.x - ann.r, y: ann.y - ann.r, w: ann.r * 2, h: ann.r * 2 };
    if (ann.type === 'brush' || ann.type === 'erase') {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        ann.path.forEach(pt => {
            if (pt.x < minX) minX = pt.x; if (pt.y < minY) minY = pt.y;
            if (pt.x > maxX) maxX = pt.x; if (pt.y > maxY) maxY = pt.y;
        });
        const pad = ann.size / 2;
        return { x: minX - pad, y: minY - pad, w: (maxX - minX) + pad * 2, h: (maxY - minY) + pad * 2 };
    }
    return { x: 0, y: 0, w: 0, h: 0 };
}


// --- EXPORTED ENGINE FUNCTIONS ---

export function resizeOffscreenCanvas(width, height) {
    offCanvas.width = width; offCanvas.height = height;
    brushCanvas.width = width; brushCanvas.height = height;
}

export function updateCursor() {
    if (state.currentTool === 'brush') {
        const size = state.brushSize * state.currentScale;
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
            <circle cx="${size/2}" cy="${size/2}" r="${(size/2) - 1}" fill="none" stroke="${state.currentColor}" stroke-width="2"/>
        </svg>`;
        const encodedSvg = encodeURIComponent(svg);
        const url = `url('data:image/svg+xml;utf8,${encodedSvg}') ${size/2} ${size/2}, auto`;
        canvas.style.cursor = url;
    } else if (state.currentTool === 'resize' || state.currentTool === 'select') {
        canvas.style.cursor = 'default';
    } else {
        canvas.style.cursor = 'crosshair';
    }
}

// --- UNDO / REDO LOGIC ---
export function saveHistory() {
    const idx = state.currentImageIndex;
    if (idx === -1) return;

    if (!state.history[idx]) {
        state.history[idx] = [];
        state.historyStep[idx] = -1;
    }

    // If we undo and then draw something new, delete the "future" redo steps
    if (state.historyStep[idx] < state.history[idx].length - 1) {
        state.history[idx] = state.history[idx].slice(0, state.historyStep[idx] + 1);
    }

    // Deep copy current annotations to prevent reference mutations
    const snapshot = JSON.parse(JSON.stringify(state.annotations[idx] || []));
    state.history[idx].push(snapshot);
    state.historyStep[idx]++;
}

export function undo() {
    const idx = state.currentImageIndex;
    if (idx === -1 || !state.history[idx] || state.historyStep[idx] <= 0) return;

    state.historyStep[idx]--;
    state.annotations[idx] = JSON.parse(JSON.stringify(state.history[idx][state.historyStep[idx]]));
    
    state.selectedAnnotations = [];
    state.resizeSelection = null;
    redrawCanvas();
}

export function redo() {
    const idx = state.currentImageIndex;
    if (idx === -1 || !state.history[idx] || state.historyStep[idx] >= state.history[idx].length - 1) return;

    state.historyStep[idx]++;
    state.annotations[idx] = JSON.parse(JSON.stringify(state.history[idx][state.historyStep[idx]]));
    
    state.selectedAnnotations = [];
    state.resizeSelection = null;
    redrawCanvas();
}
export function updateProjectTreeUI() {
    const projectTree = document.getElementById('project-tree');
    if (!projectTree) return;
    
    let html = `<b style="display:block; margin-bottom:10px; border-bottom:1px solid var(--border); padding-bottom:5px;">Folder: ${state.projectHandle ? state.projectHandle.name : ''}</b>`;
    html += `<b style="display:block; margin-bottom:8px;">Categories:</b>`;
    
    // Default "Create New" Radio
    html += `<label style="display:flex; align-items:center; gap:8px; cursor:pointer; margin-bottom:8px;">
        <input type="radio" name="category-select" value="create-new" ${state.activeCategory === 'create-new' ? 'checked' : ''}> 
        <i>Create New...</i>
    </label>`;
    
    // Existing Categories Radios
    if (state.projectMetadata && state.projectMetadata.categories) {
        state.projectMetadata.categories.forEach(cat => {
            const isChecked = state.activeCategory === cat ? 'checked' : '';
            html += `<label style="display:flex; align-items:center; gap:8px; cursor:pointer; margin-bottom:8px;">
                <input type="radio" name="category-select" value="${cat}" ${isChecked}> 
                ${cat}
            </label>`;
        });
    }
    projectTree.innerHTML = html;
}

function drawPath(context, path, color, size, isErase) {
    if (path.length < 2) return;
    context.beginPath();
    context.moveTo(path[0].x, path[0].y);
    for(let i = 1; i < path.length; i++) { context.lineTo(path[i].x, path[i].y); }
    context.lineCap = 'round'; context.lineJoin = 'round'; context.lineWidth = size;

    if (isErase) {
        context.globalCompositeOperation = 'destination-out';
        context.strokeStyle = 'rgba(0,0,0,1)';
        context.stroke();
        context.globalCompositeOperation = 'source-over'; 
    } else {
        context.strokeStyle = color;
        context.stroke();
    }
}

export function redrawCanvas() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    offCtx.clearRect(0, 0, offCanvas.width, offCanvas.height);
    brushCtx.clearRect(0, 0, brushCanvas.width, brushCanvas.height);
    
    if (state.currentImageObj) ctx.drawImage(state.currentImageObj, 0, 0);
    if (!state.showLabels) return;

    const currentAnnotations = state.annotations[state.currentImageIndex] || [];
    
    currentAnnotations.forEach(ann => {
        if (ann.type === 'brush') drawPath(brushCtx, ann.path, ann.color, ann.size, false);
        else if (ann.type === 'erase') drawPath(brushCtx, ann.path, null, ann.size, true);
    });

    if (isPainting) drawPath(brushCtx, currentBrushPath, state.currentColor, state.brushSize, false);
    else if (isErasing) drawPath(brushCtx, currentBrushPath, null, state.brushSize, true);

    offCtx.drawImage(brushCanvas, 0, 0);

    currentAnnotations.forEach(ann => {
        if (ann.type === 'rectangle' || ann.type === 'circle') {
            offCtx.strokeStyle = ann.color; offCtx.lineWidth = 2; offCtx.beginPath();
            if (ann.type === 'rectangle') offCtx.rect(ann.x, ann.y, ann.w, ann.h);
            if (ann.type === 'circle') offCtx.arc(ann.x, ann.y, ann.r, 0, 2 * Math.PI);
            offCtx.stroke();
            offCtx.fillStyle = ann.color; offCtx.font = '16px Arial';
            if (ann.type === 'rectangle') {
                offCtx.fillText(ann.label, ann.x, ann.y > 20 ? ann.y - 8 : ann.y + 20);
            } else if (ann.type === 'circle') {
                const topY = ann.y - ann.r;
                offCtx.fillText(ann.label, ann.x - ann.r, topY > 20 ? topY - 8 : topY + 20);
            }
        } 
        else if (ann.type === 'brush') {
            offCtx.fillStyle = ann.color; offCtx.font = '16px Arial';
            offCtx.fillText(ann.label, ann.path[0].x, ann.path[0].y - 10);
        }
    });

    if (isDrawingShape) {
        offCtx.strokeStyle = state.currentColor; offCtx.lineWidth = 2; offCtx.beginPath();
        if (state.currentShape === 'rectangle') offCtx.rect(startX, startY, currentX - startX, currentY - startY);
        else if (state.currentShape === 'circle') {
            const radius = Math.sqrt(Math.pow(currentX - startX, 2) + Math.pow(currentY - startY, 2));
            offCtx.arc(startX, startY, radius, 0, 2 * Math.PI);
        }
        offCtx.stroke();
    } 

    if (state.selectedAnnotations && state.selectedAnnotations.length > 0) {
        offCtx.save();
        offCtx.strokeStyle = '#00ffff'; offCtx.lineWidth = 2; offCtx.setLineDash([5, 5]);
        state.selectedAnnotations.forEach(ann => {
            const b = getBounds(ann);
            offCtx.strokeRect(b.x, b.y, b.w, b.h);
        });
        offCtx.restore();
    }

    if (isDrawingSelection) {
        offCtx.save();
        offCtx.strokeStyle = 'rgba(0, 120, 255, 0.8)'; offCtx.fillStyle = 'rgba(0, 120, 255, 0.2)'; offCtx.setLineDash([5, 5]);
        offCtx.fillRect(startX, startY, currentX - startX, currentY - startY);
        offCtx.strokeRect(startX, startY, currentX - startX, currentY - startY);
        offCtx.restore();
    }

    // NEW: Draw Resize Handles
    if (state.currentTool === 'resize' && state.resizeSelection) {
        const b = getBounds(state.resizeSelection);
        offCtx.save();
        offCtx.strokeStyle = '#ff00ff'; offCtx.lineWidth = 2; offCtx.setLineDash([4, 4]);
        offCtx.strokeRect(b.x, b.y, b.w, b.h);
        
        offCtx.fillStyle = '#ff00ff'; offCtx.setLineDash([]);
        const hs = 8; // Handle size
        offCtx.fillRect(b.x - hs/2, b.y - hs/2, hs, hs); // Top-Left
        offCtx.fillRect(b.x + b.w - hs/2, b.y - hs/2, hs, hs); // Top-Right
        offCtx.fillRect(b.x - hs/2, b.y + b.h - hs/2, hs, hs); // Bottom-Left
        offCtx.fillRect(b.x + b.w - hs/2, b.y + b.h - hs/2, hs, hs); // Bottom-Right
        offCtx.restore();
    }

    ctx.drawImage(offCanvas, 0, 0);
}

// --- EVENT LISTENERS ---

// --- EVENT LISTENERS ---

export function setupCanvasEvents() {
    canvas.addEventListener('contextmenu', e => e.preventDefault());

    canvas.addEventListener('mousedown', (e) => {
        const rect = canvas.getBoundingClientRect();
        const mouseX = (e.clientX - rect.left) / state.currentScale;
        const mouseY = (e.clientY - rect.top) / state.currentScale;

        if (state.currentTool === 'draw') {
            if (e.button !== 0) return;
            startX = mouseX; startY = mouseY; currentX = mouseX; currentY = mouseY;
            isDrawingShape = true;
        } 
        else if (state.currentTool === 'brush') {
            if (e.button === 0) { isPainting = true; currentBrushPath = [{x: mouseX, y: mouseY}]; } 
            else if (e.button === 2) { isErasing = true; currentBrushPath = [{x: mouseX, y: mouseY}]; }
        }
        else if (state.currentTool === 'select') {
            if (e.button !== 0) return;
            startX = mouseX; startY = mouseY; currentX = mouseX; currentY = mouseY;
            isDrawingSelection = true;
            state.selectedAnnotations = []; 
            redrawCanvas();
        }
        else if (state.currentTool === 'erase' || state.currentTool === 'resize') {
            if (e.button !== 0) return;
            
            if (state.currentTool === 'resize' && state.resizeSelection) {
                startX = mouseX; startY = mouseY;
                const b = getBounds(state.resizeSelection);
                const hs = 10; 
                
                // 1. Check Corner Handles
                if (Math.abs(mouseX - b.x) < hs && Math.abs(mouseY - b.y) < hs) activeHandle = 'TL';
                else if (Math.abs(mouseX - (b.x + b.w)) < hs && Math.abs(mouseY - b.y) < hs) activeHandle = 'TR';
                else if (Math.abs(mouseX - b.x) < hs && Math.abs(mouseY - (b.y + b.h)) < hs) activeHandle = 'BL';
                else if (Math.abs(mouseX - (b.x + b.w)) < hs && Math.abs(mouseY - (b.y + b.h)) < hs) activeHandle = 'BR';
                // 2. Check Inside Box for MOVE
                else if (mouseX >= b.x && mouseX <= b.x + b.w && mouseY >= b.y && mouseY <= b.y + b.h) activeHandle = 'MOVE';
                
                if (activeHandle) {
                    isResizing = true;
                    resizeOriginal = { bounds: { ...b }, ann: JSON.parse(JSON.stringify(state.resizeSelection)) };
                    return;
                }
            }

            const annotations = state.annotations[state.currentImageIndex] || [];
            let foundHit = false;
            for (let i = annotations.length - 1; i >= 0; i--) {
                const ann = annotations[i];
                let hit = false;
                
                if (ann.type === 'rectangle') {
                    if (mouseX >= ann.x && mouseX <= ann.x + ann.w && mouseY >= ann.y && mouseY <= ann.y + ann.h) hit = true;
                } else if (ann.type === 'circle') {
                    if (Math.hypot(mouseX - ann.x, mouseY - ann.y) <= ann.r) hit = true;
                } else if (ann.type === 'brush') {
                    for (let pt of ann.path) {
                        if (Math.hypot(mouseX - pt.x, mouseY - pt.y) <= (ann.size / 2) + 5) { hit = true; break; }
                    }
                }
                
                if (hit) {
                    if (state.currentTool === 'erase'){
                    annotations.splice(i, 1);
                    saveHistory();
                    }
                    else if (state.currentTool === 'resize') state.resizeSelection = ann;
                    
                    foundHit = true;
                    redrawCanvas();
                    return; 
                }
            }
            if (!foundHit && state.currentTool === 'resize') {
                state.resizeSelection = null;
                redrawCanvas();
            }
        }
    });

    canvas.addEventListener('mousemove', (e) => {
        const rect = canvas.getBoundingClientRect();
        currentX = (e.clientX - rect.left) / state.currentScale;
        currentY = (e.clientY - rect.top) / state.currentScale;

        // NEW: Dynamic Hover Cursors for Resize Tool
        if (state.currentTool === 'resize' && state.resizeSelection && !isResizing) {
            const b = getBounds(state.resizeSelection);
            const hs = 10;
            // Top-Left or Bottom-Right
            if ((Math.abs(currentX - b.x) < hs && Math.abs(currentY - b.y) < hs) || 
                (Math.abs(currentX - (b.x + b.w)) < hs && Math.abs(currentY - (b.y + b.h)) < hs)) {
                canvas.style.cursor = 'nwse-resize';
            } 
            // Top-Right or Bottom-Left
            else if ((Math.abs(currentX - (b.x + b.w)) < hs && Math.abs(currentY - b.y) < hs) || 
                     (Math.abs(currentX - b.x) < hs && Math.abs(currentY - (b.y + b.h)) < hs)) {
                canvas.style.cursor = 'nesw-resize';
            } 
            // Inside box
            else if (currentX >= b.x && currentX <= b.x + b.w && currentY >= b.y && currentY <= b.y + b.h) {
                canvas.style.cursor = 'move';
            } 
            else {
                canvas.style.cursor = 'default';
            }
        }

        if (isDrawingShape || isPainting || isErasing || isDrawingSelection) {
            if (isPainting || isErasing) currentBrushPath.push({x: currentX, y: currentY});
            redrawCanvas(); 
        }
        
        if (isResizing && state.resizeSelection && resizeOriginal) {
            const dx = currentX - startX;
            const dy = currentY - startY;
            const ob = resizeOriginal.bounds;
            
            let newX, newY, newW, newH;

            if (activeHandle === 'MOVE') {
                newX = ob.x + dx;
                newY = ob.y + dy;
                newW = ob.w;
                newH = ob.h;
            } else {
                // Center-Anchored Resize Logic
                const cx = ob.x + ob.w / 2;
                const cy = ob.y + ob.h / 2;
                
                newW = Math.max(5, Math.abs(currentX - cx) * 2);
                newH = Math.max(5, Math.abs(currentY - cy) * 2);
                
                newX = cx - newW / 2;
                newY = cy - newH / 2;
            }

            const ann = state.resizeSelection;
            const origAnn = resizeOriginal.ann;

            if (ann.type === 'rectangle') {
                ann.x = newX; ann.y = newY; ann.w = newW; ann.h = newH;
            } else if (ann.type === 'circle') {
                ann.x = newX + newW/2; ann.y = newY + newH/2; ann.r = Math.min(newW, newH)/2;
            } else if (ann.type === 'brush') {
                const scaleX = ob.w > 0 ? newW / ob.w : 1;
                const scaleY = ob.h > 0 ? newH / ob.h : 1;
                for (let i = 0; i < ann.path.length; i++) {
                    ann.path[i].x = newX + (origAnn.path[i].x - ob.x) * scaleX;
                    ann.path[i].y = newY + (origAnn.path[i].y - ob.y) * scaleY;
                }
            }
            redrawCanvas();
        }
    });

    canvas.addEventListener('mouseup', async (e) => {
        const rect = canvas.getBoundingClientRect();
        currentX = (e.clientX - rect.left) / state.currentScale;
        currentY = (e.clientY - rect.top) / state.currentScale;

        if (!state.annotations[state.currentImageIndex]) state.annotations[state.currentImageIndex] = [];

        if (isDrawingShape) {
            isDrawingShape = false;
            if (Math.abs(currentX - startX) > 5 || Math.abs(currentY - startY) > 5) { 
                // NEW: Use selected radio button, or ask if "create-new"
                let labelText = state.activeCategory;
                if (labelText === 'create-new') labelText = await askForLabel(); 

                if (labelText && labelText.trim() !== "") {
                    await addNewCategoryAndSave(labelText); 
                    state.activeCategory = labelText.trim(); // Auto-select new category
                    updateProjectTreeUI(); // Refresh radio buttons

                    let shapeData = { type: state.currentShape, color: state.currentColor, label: labelText.trim() };
                    if (state.currentShape === 'rectangle') {
                        shapeData = { ...shapeData, x: startX, y: startY, w: currentX - startX, h: currentY - startY };
                    } else if (state.currentShape === 'circle') {
                        const radius = Math.sqrt(Math.pow(currentX - startX, 2) + Math.pow(currentY - startY, 2));
                        shapeData = { ...shapeData, x: startX, y: startY, r: radius };
                    }
                    state.annotations[state.currentImageIndex].push(shapeData);
                    saveHistory();
                }
            }
        } 
        else if (isPainting) {
            isPainting = false;
            if (currentBrushPath.length > 5) {
                // NEW: Use selected radio button, or ask if "create-new"
                let labelText = state.activeCategory;
                if (labelText === 'create-new') labelText = await askForLabel();

                if (labelText && labelText.trim() !== "") {
                    await addNewCategoryAndSave(labelText); 
                    state.activeCategory = labelText.trim(); // Auto-select new category
                    updateProjectTreeUI(); // Refresh radio buttons

                    state.annotations[state.currentImageIndex].push({
                        type: 'brush', path: currentBrushPath, color: state.currentColor,
                        size: state.brushSize, label: labelText.trim()
                    });
                    saveHistory();
                }
            }
        } 
        else if (isErasing) {
            isErasing = false;
            if (currentBrushPath.length > 5) {
                state.annotations[state.currentImageIndex].push({ type: 'erase', path: currentBrushPath, size: state.brushSize });
                const annotations = state.annotations[state.currentImageIndex];
                
                const tempCanvas = document.createElement('canvas'); tempCanvas.width = canvas.width; tempCanvas.height = canvas.height;
                const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });

                for (let i = annotations.length - 1; i >= 0; i--) {
                    const ann = annotations[i];
                    if (ann.type === 'brush') {
                        tempCtx.clearRect(0, 0, tempCanvas.width, tempCanvas.height);
                        drawPath(tempCtx, ann.path, ann.color, ann.size, false);
                        annotations.forEach(eraseAnn => {
                            if (eraseAnn.type === 'erase') drawPath(tempCtx, eraseAnn.path, null, eraseAnn.size, true);
                        });

                        const b = getBounds(ann);
                        const pad = ann.size;
                        const bx = Math.max(0, b.x - pad); const by = Math.max(0, b.y - pad);
                        const bw = Math.min(tempCanvas.width - bx, b.w + pad * 2); const bh = Math.min(tempCanvas.height - by, b.h + pad * 2);

                        if (bw > 0 && bh > 0) {
                            const imgData = tempCtx.getImageData(bx, by, bw, bh);
                            let hasPixels = false;
                            for (let j = 3; j < imgData.data.length; j += 4) {
                                if (imgData.data[j] > 0) { hasPixels = true; break; }
                            }
                            if (!hasPixels) annotations.splice(i, 1);
                        }
                    }
                }
                saveHistory();
            }
        }
        else if (state.currentTool === 'select' && isDrawingSelection) {
            isDrawingSelection = false;
            const selX = Math.min(startX, currentX), selY = Math.min(startY, currentY);
            const selW = Math.abs(currentX - startX), selH = Math.abs(currentY - startY);

            if (selW > 5 && selH > 5) {
                const annotations = state.annotations[state.currentImageIndex] || [];
                annotations.forEach(ann => {
                    const b = getBounds(ann);
                    if (b.x < selX + selW && b.x + b.w > selX && b.y < selY + selH && b.y + b.h > selY) {
                        state.selectedAnnotations.push(ann);
                    }
                });
            }
        }
        else if (state.currentTool === 'resize' && isResizing) {
            isResizing = false; activeHandle = null; resizeOriginal = null;
            saveHistory();
        }
        redrawCanvas(); 
    });
}