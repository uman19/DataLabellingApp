import { state } from './state.js';

export const canvas = document.getElementById('main-canvas');
export const ctx = canvas.getContext('2d');

const offCanvas = document.createElement('canvas');
const offCtx = offCanvas.getContext('2d', { willReadFrequently: true });
const maskCanvas = document.createElement('canvas');
const maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true });

let isDrawingShape = false;
let startX = 0, startY = 0;
let currentX = 0, currentY = 0; 
let isDrawingSelection = false;
let isResizing = false;
let isBlurring = false;
let activeHandle = null; 
let resizeOriginal = null; 

let isPainting = false;
let isErasing = false;
let isMasking = false; 
let currentBrushPath = []; 
let pendingShapeData = null; 

let maskHistory = [];
let maskHistoryStep = -1;

export function openInlineInput(x, y, shapeData) {
    pendingShapeData = shapeData;
    const container = document.getElementById('inline-input-container');
    const input = document.getElementById('inline-input');
    const dropdown = document.getElementById('inline-dropdown');
    
    const rect = canvas.getBoundingClientRect();
    container.style.left = `${(x * state.currentScale) + rect.left}px`;
    container.style.top = `${(y * state.currentScale) + rect.top}px`;
    container.style.display = 'block';
    input.value = '';
    input.focus();

    const updateDropdown = () => {
        dropdown.innerHTML = '';
        const val = input.value.toLowerCase();
        state.projectMetadata.categories.forEach(cat => {
            if (cat.toLowerCase().includes(val)) {
                const li = document.createElement('li');
                li.textContent = cat;
                li.onmousedown = () => { input.value = cat; confirmInlineLabel(); };
                dropdown.appendChild(li);
            }
        });
    };
    input.oninput = updateDropdown; updateDropdown();
    input.onkeydown = (e) => { if (e.key === 'Enter') confirmInlineLabel(); if (e.key === 'Escape') cancelInlineLabel(); };
}

async function confirmInlineLabel() {
    const val = document.getElementById('inline-input').value.trim();
    if (val !== "" && pendingShapeData) {
        
        if (!state.textMode) {
            await addNewCategoryAndSave(val, state.currentColor);
            pendingShapeData.color = state.projectMetadata.categoryColors[val] || state.currentColor;
        } else {
            // FIXED: Automatically register Text OCR category with a default color
            await addNewCategoryAndSave("Text OCR", "#ffffff"); 
            pendingShapeData.color = state.projectMetadata.categoryColors["Text OCR"] || state.currentColor; 
            pendingShapeData.isText = true; // Tag for saving
        }
        
        pendingShapeData.label = val; 
        
        if (!state.annotations[state.currentImageIndex]) {
            state.annotations[state.currentImageIndex] = [];
        }
        
        state.annotations[state.currentImageIndex].push(pendingShapeData);
        saveHistory(); // This will correctly flag saveRequired
    }
    cancelInlineLabel();
    redrawCanvas();
}

function cancelInlineLabel() {
    document.getElementById('inline-input-container').style.display = 'none';
    pendingShapeData = null; 
    isMasking = false;
    maskCtx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
    redrawCanvas();
}

export function abortActiveDrawing() {
    isDrawingShape = false;
    isDrawingSelection = false;
    isPainting = false;
    isErasing = false;
    isMasking = false;
    isBlurring = false;
    isResizing = false;
    activeHandle = null;
    resizeOriginal = null;
    pendingShapeData = null;
    currentBrushPath = [];
    
    maskHistory = [];
    maskHistoryStep = -1;

    maskCtx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);

    const container = document.getElementById('inline-input-container');
    if (container) container.style.display = 'none';
    
    updateCursor();
}

export async function addNewCategoryAndSave(label, colorHex = '#00ff00') {
    if (!label || label.trim() === "") return;
    const cleanLabel = label.trim();
    
    if (!state.projectMetadata.categories.includes(cleanLabel)) {
        state.projectMetadata.categories.push(cleanLabel);
        state.projectMetadata.categoryColors[cleanLabel] = colorHex;
    }
    if (state.projectHandle) {
        try {
            await state.projectHandle.getDirectoryHandle(cleanLabel, { create: true });
            const dlaHandle = await state.projectHandle.getFileHandle('metadata.dla', { create: true });
            const writable = await dlaHandle.createWritable();
            await writable.write(JSON.stringify(state.projectMetadata));
            await writable.close();
            updateProjectTreeUI();
        } catch (error) { console.error(error); }
    }
}

function saveMaskHistory() {
    if (maskHistoryStep < maskHistory.length - 1) {
        maskHistory = maskHistory.slice(0, maskHistoryStep + 1);
    }
    maskHistory.push(maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height));
    maskHistoryStep++;
}

function getBounds(ann) {
    if (ann.type === 'rect' || ann.type === 'rectangle') return { x: ann.x, y: ann.y, w: ann.w, h: ann.h };
    if (ann.type === 'circ' || ann.type === 'circle') return { x: ann.x - ann.r, y: ann.y - ann.r, w: ann.r * 2, h: ann.r * 2 };
    if (ann.type === 'mask') return { x: ann.x, y: ann.y, w: ann.w, h: ann.h }; 
    if (ann.type === 'brush' || ann.type === 'erase') {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        if(ann.path) ann.path.forEach(pt => {
            if (pt.x < minX) minX = pt.x; if (pt.y < minY) minY = pt.y;
            if (pt.x > maxX) maxX = pt.x; if (pt.y > maxY) maxY = pt.y;
        });
        const pad = ann.size / 2;
        return { x: minX - pad, y: minY - pad, w: (maxX - minX) + pad * 2, h: (maxY - minY) + pad * 2 };
    }
    return { x: 0, y: 0, w: 0, h: 0 };
}

export function resizeOffscreenCanvas(width, height) {
    offCanvas.width = width; offCanvas.height = height;
    maskCanvas.width = width; maskCanvas.height = height;
    
    if (!state.baseCanvas) state.baseCanvas = document.createElement('canvas');
    state.baseCanvas.width = width; state.baseCanvas.height = height;
    const baseCtx = state.baseCanvas.getContext('2d');
    if (state.currentImageObj) baseCtx.drawImage(state.currentImageObj, 0, 0);
}

export function updateCursor() {
    if (state.currentTool === 'brush' || state.currentTool === 'erase' || state.currentTool === 'blur') {
        const size = state.brushSize * state.currentScale;
        const strokeColor = state.currentTool === 'blur' ? '#cccccc' : state.currentColor;
        
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
            <circle cx="${size/2}" cy="${size/2}" r="${(size/2) - 1}" fill="none" stroke="${strokeColor}" stroke-width="2" style="filter: drop-shadow(0px 0px 1px rgba(0,0,0,0.5));"/>
        </svg>`;
        const encodedSvg = encodeURIComponent(svg);
        const url = `url('data:image/svg+xml;utf8,${encodedSvg}') ${size/2} ${size/2}, auto`;
        canvas.style.cursor = url;
    } 
    else if (state.currentTool === 'resize' || state.currentTool === 'select') canvas.style.cursor = 'default';
    else canvas.style.cursor = 'crosshair';
}

export function saveHistory() {
    state.saveRequired = true; // FIXED: Crucial flag to enable saving
    
    const idx = state.currentImageIndex;
    if (idx === -1) return;
    if (!state.history[idx]) { state.history[idx] = []; state.historyStep[idx] = -1; state.savedHistoryStep[idx] = -1;}
    if (state.historyStep[idx] < state.history[idx].length - 1) state.history[idx] = state.history[idx].slice(0, state.historyStep[idx] + 1);
    
    const baseData = state.baseCanvas ? state.baseCanvas.toDataURL('image/jpeg', 0.8) : null;
    state.history[idx].push({ anns: JSON.parse(JSON.stringify(state.annotations[idx] || [])), base: baseData });
    state.historyStep[idx]++;

    if (state.history[idx].length > 15) {
        state.history[idx].shift();
        state.historyStep[idx]--;
        if (state.savedHistoryStep[idx] !== undefined) state.savedHistoryStep[idx]--;
    }
}

export function undo() {
    if (isMasking) {
        if (maskHistoryStep > 0) {
            maskHistoryStep--;
            maskCtx.putImageData(maskHistory[maskHistoryStep], 0, 0);
            redrawCanvas();
        }
        return;
    }
    const idx = state.currentImageIndex;
    if (idx === -1 || !state.history[idx] || state.historyStep[idx] <= 0) return;
    state.historyStep[idx]--;
    const snap = state.history[idx][state.historyStep[idx]];
    state.annotations[idx] = JSON.parse(JSON.stringify(snap.anns));
    
    if (snap.base) {
        const img = new Image();
        img.onload = () => { state.baseCanvas.getContext('2d').clearRect(0,0,state.baseCanvas.width, state.baseCanvas.height); state.baseCanvas.getContext('2d').drawImage(img, 0, 0); redrawCanvas(); };
        img.src = snap.base;
    }
    
    state.hideThreshold = 0;
    const hideBtn = document.getElementById('btn-hide-current');
    if (hideBtn) { hideBtn.textContent = "Hide Current"; hideBtn.classList.add('btn-secondary'); }
    
    state.selectedAnnotations = []; state.resizeSelection = null; redrawCanvas();
}

export function redo() {
    if (isMasking) {
        if (maskHistoryStep < maskHistory.length - 1) {
            maskHistoryStep++;
            maskCtx.putImageData(maskHistory[maskHistoryStep], 0, 0);
            redrawCanvas();
        }
        return;
    }
    const idx = state.currentImageIndex;
    if (idx === -1 || !state.history[idx] || state.historyStep[idx] >= state.history[idx].length - 1) return;
    state.historyStep[idx]++;
    const snap = state.history[idx][state.historyStep[idx]];
    state.annotations[idx] = JSON.parse(JSON.stringify(snap.anns));
    
    if (snap.base) {
        const img = new Image();
        img.onload = () => { state.baseCanvas.getContext('2d').clearRect(0,0,state.baseCanvas.width, state.baseCanvas.height); state.baseCanvas.getContext('2d').drawImage(img, 0, 0); redrawCanvas(); };
        img.src = snap.base;
    }

    state.hideThreshold = 0;
    const hideBtn = document.getElementById('btn-hide-current');
    if (hideBtn) { hideBtn.textContent = "Hide Current"; hideBtn.classList.add('btn-secondary'); }
    
    state.selectedAnnotations = []; state.resizeSelection = null; redrawCanvas();
}

export function updateProjectTreeUI() {
    const projectTree = document.getElementById('project-tree');
    if (!projectTree) return;
    let html = `<b style="display:block; margin-bottom:10px; border-bottom:1px solid var(--border); padding-bottom:5px;">Folder: ${state.projectHandle ? state.projectHandle.name : ''}</b>`;
    html += `<label class="cat-item"><input type="radio" name="category-select" value="create-new" ${state.activeCategory === 'create-new' ? 'checked' : ''}> <i>Create New... (Inline)</i></label>`;
    
    const searchTerm = document.getElementById('cat-search') ? document.getElementById('cat-search').value.toLowerCase() : '';
    
    if (state.projectMetadata && state.projectMetadata.categories) {
        state.projectMetadata.categories.forEach(cat => {
            if (cat.toLowerCase().includes(searchTerm)) {
                const isChecked = state.activeCategory === cat ? 'checked' : '';
                const color = state.projectMetadata.categoryColors[cat] || '#00ff00';
                
                html += `<div class="cat-item">
                    <label><input type="radio" name="category-select" value="${cat}" ${isChecked}> ${cat}</label>
                    <div>
                        <input type="color" data-cat="${cat}" class="cat-color-picker" value="${color}" title="Change Color">
                        <button class="btn-delete-cat" data-cat="${cat}" style="background:transparent; border:none; cursor:pointer; font-size:14px; margin-left:5px;" title="Delete Category">🗑️</button>
                    </div>
                </div>`;
            }
        });
    }
    projectTree.innerHTML = html;
}

export function redrawCanvas() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    offCtx.clearRect(0, 0, offCanvas.width, offCanvas.height);
    
    if (state.baseCanvas) ctx.drawImage(state.baseCanvas, 0, 0);
    const currentAnnotations = state.annotations[state.currentImageIndex] || [];
    
    if (state.showLabels) {
        currentAnnotations.forEach((ann, index) => {
            if (index < state.hideThreshold) return;
            
            // FIXED: Ensure OCR Text shapes aren't hidden by unrelated categories!
            if (ann.isText && state.hiddenCategories.includes('Text OCR')) return;
            if (!ann.isText && state.hiddenCategories.includes(ann.label)) return;

            offCtx.fillStyle = ann.color;
            offCtx.strokeStyle = ann.color; 
            offCtx.lineWidth = 2; 

            if (ann.type === 'rect' || ann.type === 'circ' || ann.type === 'rectangle' || ann.type === 'circle') {
                offCtx.beginPath();
                if (ann.type === 'rect' || ann.type === 'rectangle') offCtx.rect(ann.x, ann.y, ann.w, ann.h);
                if (ann.type === 'circ' || ann.type === 'circle') offCtx.arc(ann.x, ann.y, ann.r, 0, 2 * Math.PI);
                offCtx.stroke();
                
                offCtx.globalAlpha = 1.0;
                offCtx.font = '16px Arial';
                if (ann.type === 'rect' || ann.type === 'rectangle') offCtx.fillText(ann.label, ann.x, ann.y > 20 ? ann.y - 8 : ann.y + 20);
                else offCtx.fillText(ann.label, ann.x - ann.r, (ann.y - ann.r) > 20 ? (ann.y - ann.r) - 8 : (ann.y - ann.r) + 20);
            
            } else if (ann.type === 'mask') {
                offCtx.globalAlpha = 0.3;
                if (typeof ann.imgData === 'string') {
                    if (!ann.cachedImg) {
                        const img = new Image();
                        img.onload = () => { ann.cachedImg = img; redrawCanvas(); };
                        img.src = ann.imgData;
                    } else {
                        offCtx.drawImage(ann.cachedImg, ann.x, ann.y);
                    }
                }
                offCtx.globalAlpha = 1.0;
                offCtx.fillText(ann.label, ann.x, ann.y - 10);
            
            } else if (ann.type === 'brush') {
                if (ann.path && ann.path.length > 0) {
                    offCtx.beginPath(); offCtx.moveTo(ann.path[0].x, ann.path[0].y);
                    for(let i=1; i<ann.path.length; i++) offCtx.lineTo(ann.path[i].x, ann.path[i].y);
                    offCtx.lineCap = 'round'; offCtx.lineJoin = 'round'; offCtx.lineWidth = ann.size;
                    offCtx.stroke();
                    offCtx.fillText(ann.label, ann.path[0].x, ann.path[0].y - 10);
                }
            }
        });
    }

    if (isDrawingShape) {
        offCtx.strokeStyle = state.currentColor; offCtx.lineWidth = 2; offCtx.beginPath();
        if (state.currentTool === 'rect') offCtx.rect(startX, startY, currentX - startX, currentY - startY);
        else if (state.currentTool === 'circ') {
            const radius = Math.sqrt(Math.pow(currentX - startX, 2) + Math.pow(currentY - startY, 2));
            offCtx.arc(startX, startY, radius, 0, 2 * Math.PI);
        }
        offCtx.stroke();
    } 

    if (isMasking) {
        offCtx.globalAlpha = 0.3;
        offCtx.drawImage(maskCanvas, 0, 0);
        offCtx.globalAlpha = 1.0;
    }

    if (state.selectedAnnotations && state.selectedAnnotations.length > 0) {
        offCtx.save(); offCtx.strokeStyle = '#00ffff'; offCtx.lineWidth = 2; offCtx.setLineDash([5, 5]);
        state.selectedAnnotations.forEach(ann => { const b = getBounds(ann); offCtx.strokeRect(b.x, b.y, b.w, b.h); });
        offCtx.restore();
    }

    if (isDrawingSelection) {
        offCtx.save(); offCtx.strokeStyle = 'rgba(0, 120, 255, 0.8)'; offCtx.fillStyle = 'rgba(0, 120, 255, 0.2)'; offCtx.setLineDash([5, 5]);
        offCtx.fillRect(startX, startY, currentX - startX, currentY - startY);
        offCtx.strokeRect(startX, startY, currentX - startX, currentY - startY);
        offCtx.restore();
    }

    if (state.currentTool === 'resize' && state.resizeSelection) {
        const b = getBounds(state.resizeSelection);
        offCtx.save(); offCtx.strokeStyle = '#ff00ff'; offCtx.lineWidth = 2; offCtx.setLineDash([4, 4]); offCtx.strokeRect(b.x, b.y, b.w, b.h);
        offCtx.fillStyle = '#ff00ff'; offCtx.setLineDash([]); const hs = 8;
        offCtx.fillRect(b.x - hs/2, b.y - hs/2, hs, hs); offCtx.fillRect(b.x + b.w - hs/2, b.y - hs/2, hs, hs); 
        offCtx.fillRect(b.x - hs/2, b.y + b.h - hs/2, hs, hs); offCtx.fillRect(b.x + b.w - hs/2, b.y + b.h - hs/2, hs, hs); 
        offCtx.restore();
    }

    ctx.drawImage(offCanvas, 0, 0);
}

export function setupCanvasEvents() {
    canvas.addEventListener('contextmenu', e => e.preventDefault());

    canvas.addEventListener('mousedown', (e) => {
        if (document.getElementById('inline-input-container').style.display === 'block') return;

        const rect = canvas.getBoundingClientRect();
        const mouseX = (e.clientX - rect.left) / state.currentScale; 
        const mouseY = (e.clientY - rect.top) / state.currentScale;

        if (state.currentTool === 'rect' || state.currentTool === 'circ') {
            if (e.button !== 0) return;
            startX = mouseX; startY = mouseY; currentX = mouseX; currentY = mouseY;
            isDrawingShape = true;
        } 
        else if (state.currentTool === 'brush') {
            startX = mouseX; startY = mouseY;
            if (!isMasking) {
                isMasking = true;
                maskHistory = [];
                maskHistoryStep = -1;
                saveMaskHistory(); // Save the blank state
            }            
            if (e.button === 0) { 
                isPainting = true; 
                maskCtx.globalCompositeOperation = 'source-over'; maskCtx.fillStyle = state.currentColor;
                maskCtx.beginPath(); maskCtx.arc(mouseX, mouseY, state.brushSize / 2, 0, Math.PI * 2); maskCtx.fill();
                redrawCanvas();
            } 
            else if (e.button === 2) { 
                isErasing = true; 
                maskCtx.globalCompositeOperation = 'destination-out'; maskCtx.fillStyle = 'rgba(0,0,0,1)';
                maskCtx.beginPath(); maskCtx.arc(mouseX, mouseY, state.brushSize / 2, 0, Math.PI * 2); maskCtx.fill();
                redrawCanvas();
            }
        }
        else if (state.currentTool === 'blur') { 
            if (e.button !== 0) return; 
            isBlurring = true; startX = mouseX; startY = mouseY; 
            if (state.baseCanvas) {
                const bCtx = state.baseCanvas.getContext('2d');
                bCtx.save(); bCtx.beginPath(); bCtx.arc(mouseX, mouseY, state.brushSize / 2, 0, Math.PI * 2); bCtx.clip();
                bCtx.filter = 'blur(10px)'; bCtx.drawImage(state.baseCanvas, 0, 0); bCtx.restore(); redrawCanvas();
            }
        }
        else if (state.currentTool === 'select') {
            if (e.button !== 0) return;
            startX = mouseX; startY = mouseY; currentX = mouseX; currentY = mouseY;
            isDrawingSelection = true; state.selectedAnnotations = []; redrawCanvas();
        }
        else if (state.currentTool === 'erase' || state.currentTool === 'resize') {
            if (e.button !== 0) return;
            if (state.currentTool === 'resize' && state.resizeSelection) {
                startX = mouseX; startY = mouseY; const b = getBounds(state.resizeSelection); const hs = 10; 
                if (Math.abs(mouseX - b.x) < hs && Math.abs(mouseY - b.y) < hs) activeHandle = 'TL';
                else if (Math.abs(mouseX - (b.x + b.w)) < hs && Math.abs(mouseY - b.y) < hs) activeHandle = 'TR';
                else if (Math.abs(mouseX - b.x) < hs && Math.abs(mouseY - (b.y + b.h)) < hs) activeHandle = 'BL';
                else if (Math.abs(mouseX - (b.x + b.w)) < hs && Math.abs(mouseY - (b.y + b.h)) < hs) activeHandle = 'BR';
                else if (mouseX >= b.x && mouseX <= b.x + b.w && mouseY >= b.y && mouseY <= b.y + b.h) activeHandle = 'MOVE';
                if (activeHandle) { isResizing = true; resizeOriginal = { bounds: { ...b }, ann: JSON.parse(JSON.stringify(state.resizeSelection)) }; return; }
            }

            const annotations = state.annotations[state.currentImageIndex] || [];
            let foundHit = false;
            for (let i = annotations.length - 1; i >= 0; i--) {
                if (i < state.hideThreshold) continue; 
                const ann = annotations[i];
                
                // FIXED: Hit-Testing also safely checks OCR text visibility rules
                if (ann.isText && state.hiddenCategories.includes('Text OCR')) continue;
                if (!ann.isText && state.hiddenCategories.includes(ann.label)) continue;
                
                let hit = false;
                if (ann.type === 'rect' || ann.type === 'rectangle') {
                    if (mouseX >= ann.x && mouseX <= ann.x + ann.w && mouseY >= ann.y && mouseY <= ann.y + ann.h) hit = true;
                } else if (ann.type === 'circ' || ann.type === 'circle') {
                    if (Math.hypot(mouseX - ann.x, mouseY - ann.y) <= ann.r) hit = true;
                } else if (ann.type === 'mask') {
                    if (mouseX >= ann.x && mouseX <= ann.x + ann.w && mouseY >= ann.y && mouseY <= ann.y + ann.h) hit = true;
                } else if (ann.type === 'brush') {
                    if(ann.path) ann.path.forEach(pt => { if (Math.hypot(mouseX - pt.x, mouseY - pt.y) <= (ann.size / 2) + 5) hit = true; });
                }
                
                if (hit) {
                    if (state.currentTool === 'erase'){ annotations.splice(i, 1); saveHistory(); }
                    else if (state.currentTool === 'resize') state.resizeSelection = ann;
                    foundHit = true; redrawCanvas(); return; 
                }
            }
            if (!foundHit && state.currentTool === 'resize') { state.resizeSelection = null; redrawCanvas(); }
        }
    });

    canvas.addEventListener('mousemove', (e) => {
        const rect = canvas.getBoundingClientRect();
        currentX = (e.clientX - rect.left) / state.currentScale; 
        currentY = (e.clientY - rect.top) / state.currentScale;

        if (isBlurring && state.baseCanvas) {
            const bCtx = state.baseCanvas.getContext('2d');
            bCtx.save(); bCtx.beginPath(); bCtx.arc(currentX, currentY, state.brushSize / 2, 0, Math.PI * 2); bCtx.clip();
            bCtx.filter = 'blur(10px)'; bCtx.drawImage(state.baseCanvas, 0, 0); bCtx.restore(); redrawCanvas();
        }

        if (state.currentTool === 'resize' && state.resizeSelection && !isResizing) {
            const b = getBounds(state.resizeSelection); const hs = 10;
            if ((Math.abs(currentX - b.x) < hs && Math.abs(currentY - b.y) < hs) || (Math.abs(currentX - (b.x + b.w)) < hs && Math.abs(currentY - (b.y + b.h)) < hs)) canvas.style.cursor = 'nwse-resize';
            else if ((Math.abs(currentX - (b.x + b.w)) < hs && Math.abs(currentY - b.y) < hs) || (Math.abs(currentX - b.x) < hs && Math.abs(currentY - (b.y + b.h)) < hs)) canvas.style.cursor = 'nesw-resize';
            else if (currentX >= b.x && currentX <= b.x + b.w && currentY >= b.y && currentY <= b.y + b.h) canvas.style.cursor = 'move';
            else canvas.style.cursor = 'default';
        }

        if (isDrawingShape || isDrawingSelection) redrawCanvas(); 
        
        if (isPainting || isErasing) {
            maskCtx.globalCompositeOperation = isErasing ? 'destination-out' : 'source-over';
            maskCtx.strokeStyle = isErasing ? 'rgba(0,0,0,1)' : state.currentColor;
            maskCtx.lineWidth = state.brushSize; maskCtx.lineCap = 'round'; maskCtx.lineJoin = 'round';
            maskCtx.beginPath(); maskCtx.moveTo(startX, startY); maskCtx.lineTo(currentX, currentY); maskCtx.stroke();
            startX = currentX; startY = currentY; redrawCanvas(); 
        }

        if (isResizing && state.resizeSelection && resizeOriginal) {
            const dx = currentX - startX; const dy = currentY - startY; const ob = resizeOriginal.bounds; let newX, newY, newW, newH;
            if (activeHandle === 'MOVE') { newX = ob.x + dx; newY = ob.y + dy; newW = ob.w; newH = ob.h; } 
            else {
                const cx = ob.x + ob.w / 2; const cy = ob.y + ob.h / 2;
                newW = Math.max(5, Math.abs(currentX - cx) * 2); newH = Math.max(5, Math.abs(currentY - cy) * 2);
                newX = cx - newW / 2; newY = cy - newH / 2;
            }

            const ann = state.resizeSelection;
            if (ann.type === 'rect' || ann.type === 'rectangle') { ann.x = newX; ann.y = newY; ann.w = newW; ann.h = newH; } 
            else if (ann.type === 'circ' || ann.type === 'circle') { ann.x = newX + newW/2; ann.y = newY + newH/2; ann.r = Math.min(newW, newH)/2; }
            redrawCanvas();
        }
    });

    canvas.addEventListener('mouseup', async (e) => {
        if (isBlurring) { isBlurring = false; saveHistory(); return; }

        if (isDrawingShape) {
            isDrawingShape = false;
            if (Math.abs(currentX - startX) > 5 || Math.abs(currentY - startY) > 5) { 
                let shapeData = { type: state.currentTool, color: state.currentColor };
                if (state.currentTool === 'rect') shapeData = { ...shapeData, x: startX, y: startY, w: currentX - startX, h: currentY - startY };
                else if (state.currentTool === 'circ') shapeData = { ...shapeData, x: startX, y: startY, r: Math.sqrt(Math.pow(currentX - startX, 2) + Math.pow(currentY - startY, 2)) };

                if (state.activeCategory === 'create-new' || state.textMode) {
                    openInlineInput(currentX, currentY, shapeData);
                } else {
                    shapeData.label = state.activeCategory;
                    shapeData.color = state.projectMetadata.categoryColors[state.activeCategory] || state.currentColor;
                    if (!state.annotations[state.currentImageIndex]) state.annotations[state.currentImageIndex] = [];
                    state.annotations[state.currentImageIndex].push(shapeData);
                    saveHistory(); redrawCanvas();
                }
            }
        } 
        else if (isPainting || isErasing) {
            isPainting = false; isErasing = false;
            saveMaskHistory();
            redrawCanvas();
        }
        else if (state.currentTool === 'select' && isDrawingSelection) {
            isDrawingSelection = false;
            const selX = Math.min(startX, currentX), selY = Math.min(startY, currentY);
            const selW = Math.abs(currentX - startX), selH = Math.abs(currentY - startY);

            if (selW > 5 && selH > 5) {
                const annotations = state.annotations[state.currentImageIndex] || [];
                annotations.forEach((ann, index) => {
                    if (index < state.hideThreshold) return; 
                    
                    // FIXED: Select Tool visibility hit-checking logic updated for Text OCR
                    if (ann.isText && state.hiddenCategories.includes('Text OCR')) return;
                    if (!ann.isText && state.hiddenCategories.includes(ann.label)) return; 
                    
                    const b = getBounds(ann);
                    if (b.x < selX + selW && b.x + b.w > selX && b.y < selY + selH && b.y + b.h > selY) state.selectedAnnotations.push(ann);
                });
            }
            // FIXED: Instantly render the new highlighted bounds when mouse is released!
            redrawCanvas();
        }
        else if (state.currentTool === 'resize' && isResizing) { isResizing = false; activeHandle = null; resizeOriginal = null; saveHistory(); }
    });

    window.addEventListener('keydown', (e) => {
        if (state.currentTool === 'brush' && isMasking && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            
            const mData = maskCtx.getImageData(0,0,maskCanvas.width, maskCanvas.height);
            let minX = mData.width, minY = mData.height, maxX = 0, maxY = 0;
            for(let y=0; y<mData.height; y++){
                for(let x=0; x<mData.width; x++){
                    if(mData.data[(y*mData.width+x)*4+3] > 0){
                        if(x<minX) minX=x; if(x>maxX) maxX=x; if(y<minY) minY=y; if(y>maxY) maxY=y;
                    }
                }
            }
            if (maxX >= minX) {
                const maskCrop = maskCtx.getImageData(minX, minY, maxX-minX+1, maxY-minY+1);
                
                const tempC = document.createElement('canvas'); 
                tempC.width = maskCrop.width; tempC.height = maskCrop.height;
                tempC.getContext('2d').putImageData(maskCrop, 0, 0);
                const b64 = tempC.toDataURL();

                let shapeData = { type: 'mask', x: minX, y: minY, w: maskCrop.width, h: maskCrop.height, imgData: b64, color: state.currentColor };
                
                if (state.activeCategory === 'create-new' || state.textMode) {
                    openInlineInput(maxX, maxY, shapeData);
                } else {
                    shapeData.label = state.activeCategory;
                    shapeData.color = state.projectMetadata.categoryColors[state.activeCategory] || state.currentColor;
                    if (!state.annotations[state.currentImageIndex]) state.annotations[state.currentImageIndex] = [];
                    state.annotations[state.currentImageIndex].push(shapeData);
                    saveHistory(); redrawCanvas();
                }
            }
            
            isMasking = false; 
            maskHistory = [];
            maskHistoryStep = -1;
            maskCtx.clearRect(0,0,maskCanvas.width, maskCanvas.height);
            redrawCanvas();
        }
    });
}