import { state } from './state.js';
import { canvas, ctx, redrawCanvas, setupCanvasEvents, updateCursor, resizeOffscreenCanvas, saveHistory, undo, redo, updateProjectTreeUI, abortActiveDrawing, getBounds } from './canvasEngine.js';

// --- Theme Toggle Logic ---
const themeBtn = document.getElementById('btn-theme-toggle');
const currentTheme = localStorage.getItem('annotator-theme') || 'dark';
if (currentTheme === 'light') { document.documentElement.setAttribute('data-theme', 'light'); themeBtn.textContent = '🌘 Dark Mode'; }

themeBtn.addEventListener('click', () => {
    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    if (isLight) {
        document.documentElement.removeAttribute('data-theme'); localStorage.setItem('annotator-theme', 'dark'); themeBtn.textContent = '☀️ Light Mode';
    } else {
        document.documentElement.setAttribute('data-theme', 'light'); localStorage.setItem('annotator-theme', 'light'); themeBtn.textContent = '🌘 Dark Mode';
    }
});

const DOM = {
    landingPage: document.getElementById('landing-page'), app: document.getElementById('app'),
    btnCreate: document.getElementById('btn-create-project'), btnOpen: document.getElementById('btn-open-project'),
    projectTree: document.getElementById('project-tree'), uploadOverlay: document.getElementById('upload-overlay'),
    fileInput: document.getElementById('file-input'), dropZone: document.getElementById('drop-zone'),
    imageListPanel: document.getElementById('image-list'), zoomSlider: document.getElementById('zoom-slider'),
    zoomVal: document.getElementById('zoom-val'), toolIcons: document.querySelectorAll('.tool-icon') 
};

setupCanvasEvents();
updateCursor(); 

// --- Toolbar Events ---
DOM.toolIcons.forEach(icon => {
    icon.addEventListener('click', (e) => {
        // FIXED: Wipe any unfinalized mask/shape when switching tools
        abortActiveDrawing(); 
        
        DOM.toolIcons.forEach(ic => ic.classList.remove('active'));
        e.currentTarget.classList.add('active');
        state.currentTool = e.currentTarget.id.replace('tool-', '');
        updateCursor(); 
        if (state.currentTool !== 'select') state.selectedAnnotations = [];
        if (state.currentTool !== 'resize') state.resizeSelection = null;
        redrawCanvas();
    });
});

// --- Text Mode & Visibility ---
document.getElementById('btn-text-mode').addEventListener('click', (e) => {
    state.textMode = !state.textMode;
    e.target.textContent = state.textMode ? "Text Mode: ON" : "Text Mode: OFF";
    if (state.textMode) e.target.classList.remove('btn-secondary'); else e.target.classList.add('btn-secondary');
});

document.getElementById('btn-hide-current').addEventListener('click', (e) => {
    const isHidden = e.target.textContent === "Show All";
    if (isHidden) {
        state.hideThreshold = 0; e.target.textContent = "Hide Current"; e.target.classList.add('btn-secondary');
    } else {
        const currentAnns = state.annotations[state.currentImageIndex] || [];
        state.hideThreshold = currentAnns.length; e.target.textContent = "Show All"; e.target.classList.remove('btn-secondary');
    }
    redrawCanvas();
});

// --- Review Labels Dropdown Logic ---
const reviewBtn = document.getElementById('btn-review-labels');
const reviewDrop = document.getElementById('review-dropdown');
reviewBtn.addEventListener('click', () => reviewDrop.classList.toggle('show'));

function renderReviewCheckboxes() {
    const list = document.getElementById('review-category-list');
    list.innerHTML = '';
    const term = document.getElementById('review-search').value.toLowerCase();
    
    state.projectMetadata.categories.forEach(cat => {
        if (cat.toLowerCase().includes(term)) {
            const isChecked = !state.hiddenCategories.includes(cat);
            const lbl = document.createElement('label');
            lbl.innerHTML = `<input type="checkbox" value="${cat}" ${isChecked ? 'checked' : ''}> ${cat}`;
            lbl.querySelector('input').addEventListener('change', (e) => {
                if(e.target.checked) state.hiddenCategories = state.hiddenCategories.filter(c => c !== cat);
                else state.hiddenCategories.push(cat);
                
                state.hideThreshold = 0;
                document.getElementById('btn-hide-current').textContent = "Hide Current";
                document.getElementById('btn-hide-current').classList.add('btn-secondary');
                redrawCanvas();
            });
            list.appendChild(lbl);
        }
    });
}

document.getElementById('review-search').addEventListener('input', renderReviewCheckboxes);
document.getElementById('review-select-all').addEventListener('change', (e) => {
    if (e.target.checked) state.hiddenCategories = [];
    else state.hiddenCategories = [...state.projectMetadata.categories];
    
    state.hideThreshold = 0;
    document.getElementById('btn-hide-current').textContent = "Hide Current";
    document.getElementById('btn-hide-current').classList.add('btn-secondary');
    renderReviewCheckboxes(); redrawCanvas();
});

// --- Category Search, Colors & Deletion ---
document.getElementById('cat-search').addEventListener('input', updateProjectTreeUI);

document.getElementById('project-tree').addEventListener('change', (e) => {
    if (e.target.name === 'category-select') {
        state.activeCategory = e.target.value;
        
        // FIXED: Sync brush color to the selected category
        if (state.activeCategory !== 'create-new') {
            state.currentColor = state.projectMetadata.categoryColors[state.activeCategory] || '#00ff00';
        }
    }
    else if (e.target.classList.contains('cat-color-picker')) {
        const cat = e.target.getAttribute('data-cat');
        state.projectMetadata.categoryColors[cat] = e.target.value;
        
        // Ensure current color updates if modifying the active category
        if (state.activeCategory === cat) state.currentColor = e.target.value;
        
        Object.values(state.annotations).forEach(imgAnns => {
            imgAnns.forEach(ann => { 
                if (ann.isText && cat === 'Text OCR') ann.color = e.target.value;
                else if (!ann.isText && ann.label === cat) ann.color = e.target.value;
            });
        });
        redrawCanvas();
    }
});

document.getElementById('project-tree').addEventListener('click', async (e) => {
    if (e.target.classList.contains('btn-delete-cat')) {
        const cat = e.target.getAttribute('data-cat');
        
        if (confirm(`Are you sure you want to delete the category "${cat}"?\n\nThis will remove its labels from your active session immediately. The folder will be permanently deleted from your hard drive when you click Save.`)) {
            
            state.projectMetadata.categories = state.projectMetadata.categories.filter(c => c !== cat);
            delete state.projectMetadata.categoryColors[cat];
            
            Object.keys(state.annotations).forEach(imgIdx => {
                state.annotations[imgIdx] = state.annotations[imgIdx].filter(ann => {
                    if (cat === 'Text OCR' && ann.isText) return false;
                    if (ann.label === cat && !ann.isText) return false;
                    return true;
                });
            });
            
            if (state.projectMetadata.imageLabels) {
                Object.keys(state.projectMetadata.imageLabels).forEach(imgName => {
                    state.projectMetadata.imageLabels[imgName] = state.projectMetadata.imageLabels[imgName].filter(ann => {
                        if (cat === 'Text OCR' && ann.isText) return false;
                        if (ann.label === cat && !ann.isText) return false;
                        return true;
                    });
                });
            }

            if (!state.pendingDeletions) state.pendingDeletions = [];
            if (!state.pendingDeletions.includes(cat)) state.pendingDeletions.push(cat);
            
            state.saveRequired = true; 
            if (state.activeCategory === cat) state.activeCategory = 'create-new';
            state.hiddenCategories = state.hiddenCategories.filter(c => c !== cat);
            
            updateProjectTreeUI();
            if (typeof renderReviewCheckboxes === 'function') renderReviewCheckboxes();
            redrawCanvas();
        }
    }
});

document.getElementById('btn-add-images').addEventListener('click', () => document.getElementById('file-input').click());

// --- Zoom Controls ---
function updateZoom() {
    state.currentScale = DOM.zoomSlider.value / 100;
    DOM.zoomVal.innerText = `${DOM.zoomSlider.value}%`;
    if (state.currentImageObj) {
        canvas.style.width = (state.currentImageObj.width * state.currentScale) + 'px';
        canvas.style.height = (state.currentImageObj.height * state.currentScale) + 'px';
    }
    updateCursor(); 
}
DOM.zoomSlider.addEventListener('input', updateZoom);
document.getElementById('btn-zoom-in').addEventListener('click', () => { DOM.zoomSlider.value = Math.min(300, parseInt(DOM.zoomSlider.value) + 10); updateZoom(); });
document.getElementById('btn-zoom-out').addEventListener('click', () => { DOM.zoomSlider.value = Math.max(10, parseInt(DOM.zoomSlider.value) - 10); updateZoom(); });

canvas.addEventListener('wheel', (e) => {
    if (state.currentTool !== 'brush' && state.currentTool !== 'erase' && state.currentTool !== 'blur') return;
    e.preventDefault(); 
    state.brushSize += e.deltaY < 0 ? 2 : -2;
    state.brushSize = Math.max(2, Math.min(state.brushSize, 200)); 
    updateCursor(); 
});

// --- File System ---
DOM.btnCreate.addEventListener('click', async () => {
    try {
        state.projectHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
        const dlaHandle = await state.projectHandle.getFileHandle('metadata.dla', { create: true });
        const writable = await dlaHandle.createWritable();
        await writable.write(JSON.stringify(state.projectMetadata));
        await writable.close();
        initAppWorkspace();
    } catch (error) { console.error(error); }
});

DOM.btnOpen.addEventListener('click', async () => {
    try {
        state.projectHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
    } catch (e) { return; }
    
    try {
        const dlaHandle = await state.projectHandle.getFileHandle('metadata.dla');
        const file = await dlaHandle.getFile();
        state.projectMetadata = JSON.parse(await file.text());
    } catch (error) {
        alert("Could not find metadata.dla. Are you sure this is a valid AI Annotator project folder?");
        return;
    }

    try {
        if (!state.projectMetadata.categoryColors) state.projectMetadata.categoryColors = {};
        initAppWorkspace();
        await loadExistingProjectData(); 
    } catch (error) {
        console.error("Project load error:", error);
        alert("Project loaded, but there was an issue reading some image files. Check console.");
    }
});

async function loadExistingProjectData() {
    state.imageFiles = []; state.annotations = {}; const loadedImageNames = new Set();
    
    for (const cat of state.projectMetadata.categories) {
        try {
            const catDirHandle = await state.projectHandle.getDirectoryHandle(cat);
            for await (const entry of catDirHandle.values()) {
                if (entry.kind === 'file' && entry.name.match(/\.(png|jpe?g|webp)$/i) && !entry.name.includes('_annotated')) {
                    if (!loadedImageNames.has(entry.name)) {
                        loadedImageNames.add(entry.name);
                        const file = await entry.getFile();
                        state.imageFiles.push(file);
                        const newIndex = state.imageFiles.length - 1;
                        let restoredAnns = [];
                        
                        if (state.projectMetadata.imageLabels && state.projectMetadata.imageLabels[entry.name]) {
                            restoredAnns = state.projectMetadata.imageLabels[entry.name];
                            restoredAnns = restoredAnns.filter(ann => {
                                if (ann.type === 'rectangle') ann.type = 'rect';
                                if (ann.type === 'circle') ann.type = 'circ';
                                if (ann.type === 'mask' && typeof ann.imgData === 'object') return false; 
                                return true;
                            });
                        } 
                        state.annotations[newIndex] = restoredAnns;
                    }
                }
            }
        } catch (err) { }
    }
    updateImagePanel();
    if (state.imageFiles.length > 0) loadImageOntoCanvas(0);
}

function initAppWorkspace() {
    DOM.landingPage.style.display = 'none'; DOM.app.style.display = 'flex';
    updateProjectTreeUI(); renderReviewCheckboxes();
}

DOM.uploadOverlay.addEventListener('click', () => DOM.fileInput.click());
DOM.fileInput.addEventListener('change', (e) => { handleNewFiles(e.target.files); DOM.fileInput.value = ''; });
DOM.dropZone.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); });
DOM.dropZone.addEventListener('drop', (e) => { e.preventDefault(); e.stopPropagation(); if (e.dataTransfer.files.length > 0) handleNewFiles(e.dataTransfer.files); });

function handleNewFiles(files) {
    let added = false;
    for (let i = 0; i < files.length; i++) {
        if (files[i].type.startsWith('image/') && !state.imageFiles.some(f => f.name === files[i].name)) {
            state.imageFiles.push(files[i]);
            added = true;
        }
    }
    if (added) { updateImagePanel(); if (state.currentImageIndex === -1) loadImageOntoCanvas(0); }
}

function updateImagePanel() {
    DOM.imageListPanel.innerHTML = '';
    state.imageFiles.forEach((file, index) => {
        const item = document.createElement('div');
        item.className = 'image-list-item' + (index === state.currentImageIndex ? ' active' : '');
        item.textContent = file.name;
        item.addEventListener('click', () => loadImageOntoCanvas(index));
        DOM.imageListPanel.appendChild(item);
    });
}

function loadImageOntoCanvas(index) {
    if (index < 0 || index >= state.imageFiles.length) return;
    
    abortActiveDrawing(); 
    
    state.currentImageIndex = index;
    const file = state.imageFiles[index];
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    
    img.onload = () => {
        state.currentImageObj = img;
        DOM.uploadOverlay.style.display = 'none';
        canvas.style.display = 'inline-block';
        
        canvas.width = img.width; canvas.height = img.height;
        canvas.style.width = (img.width * state.currentScale) + 'px'; canvas.style.height = (img.height * state.currentScale) + 'px';
        resizeOffscreenCanvas(img.width, img.height); 
        
        if (!state.annotations[index]) state.annotations[index] = [];
        
        if (!state.history[index]) {
            state.history[index] = [{anns: JSON.parse(JSON.stringify(state.annotations[index])), base: state.baseCanvas.toDataURL('image/jpeg', 0.8)}];
            state.historyStep[index] = 0;
            state.savedHistoryStep[index] = 0; 
        }

        state.hideThreshold = 0;
        const hideBtn = document.getElementById('btn-hide-current');
        if (hideBtn) {
            hideBtn.textContent = "Hide Current";
            hideBtn.classList.add('btn-secondary');
        }

        redrawCanvas(); updateImagePanel(); URL.revokeObjectURL(objectUrl);
    };
    img.src = objectUrl;
}

// --- Keyboard Navigation ---
window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return; }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); redo(); return; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && state.selectedAnnotations.length > 0 && e.target.tagName !== 'INPUT') {
        const anns = state.annotations[state.currentImageIndex];
        state.annotations[state.currentImageIndex] = anns.filter(a => !state.selectedAnnotations.includes(a));
        state.selectedAnnotations = []; saveHistory(); redrawCanvas(); return;
    }
    if (state.currentImageIndex !== -1 && e.target.tagName !== 'INPUT') {
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') loadImageOntoCanvas(state.currentImageIndex + 1);
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') loadImageOntoCanvas(state.currentImageIndex - 1);
    }
});

// --- Resizer Logic ---
const resizerLeft = document.getElementById('resizer-left'); const resizerRight = document.getElementById('resizer-right');
const leftPanel = document.querySelector('.left-tools'); const rightPanel = document.querySelector('.right-panels');
let isResizingLeft = false; let isResizingRight = false;

resizerLeft.addEventListener('mousedown', (e) => { isResizingLeft = true; document.body.style.cursor = 'col-resize'; resizerLeft.classList.add('resizing'); e.preventDefault(); });
resizerRight.addEventListener('mousedown', (e) => { isResizingRight = true; document.body.style.cursor = 'col-resize'; resizerRight.classList.add('resizing'); e.preventDefault(); });

window.addEventListener('mousemove', (e) => {
    if (!isResizingLeft && !isResizingRight) return;
    e.preventDefault();
    if (isResizingLeft) { const newWidth = e.clientX; if (newWidth >= 60 && newWidth <= 300) leftPanel.style.width = `${newWidth}px`; }
    if (isResizingRight) { const newWidth = window.innerWidth - e.clientX; if (newWidth >= 150 && newWidth <= 600) rightPanel.style.width = `${newWidth}px`; }
});

window.addEventListener('mouseup', () => {
    if (isResizingLeft || isResizingRight) {
        isResizingLeft = false; isResizingRight = false; document.body.style.cursor = ''; resizerLeft.classList.remove('resizing'); resizerRight.classList.remove('resizing');
    }
});

// --- Save & Close ---
async function saveAllData() {
    if (!state.projectHandle) return 0;
    
    let imagesToSave = [];
    for (let i = 0; i < state.imageFiles.length; i++) {
        if (state.historyStep[i] !== state.savedHistoryStep[i]) imagesToSave.push(i);
    }

    if (imagesToSave.length === 0 && (!state.pendingDeletions || state.pendingDeletions.length === 0)) return -1;

    const btnSaveMain = document.getElementById('btn-save');
    btnSaveMain.textContent = "Saving..."; btnSaveMain.disabled = true;
    let savedCount = 0;
    
    const savePromises = imagesToSave.map(async (i) => {
        const file = state.imageFiles[i];
        const annotations = state.annotations[i] || [];

        let finalImageData = null;
        if (i === state.currentImageIndex && state.baseCanvas) {
            finalImageData = await new Promise(res => state.baseCanvas.toBlob(res, file.type || 'image/jpeg'));
        } else if (state.history[i] && state.historyStep[i] >= 0) {
            const snap = state.history[i][state.historyStep[i]];
            if (snap && snap.base) {
                finalImageData = await fetch(snap.base).then(r => r.blob());
            }
        }
        
        if (!finalImageData) {
            try { finalImageData = await file.arrayBuffer(); } catch (err) {}
        }

        if (annotations.length === 0 && !finalImageData) return; 

        const folderMap = {};
        const erasers = annotations.filter(a => a.type === 'erase');

        annotations.forEach(ann => {
            if (ann.type === 'erase') return;
            const folderName = ann.isText ? "Text OCR" : ann.label;
            if (!folderName) return;
            if (!folderMap[folderName]) folderMap[folderName] = [...erasers];
            folderMap[folderName].push(ann);
        });

        const activeFolders = Object.keys(folderMap);
        if (activeFolders.length === 0) {
            state.savedHistoryStep[i] = state.historyStep[i];
            return; 
        }

        let imgObj = null;
        if (finalImageData) {
            try {
                const blob = finalImageData instanceof Blob ? finalImageData : new Blob([finalImageData], { type: file.type });
                imgObj = await createImageBitmap(blob);
            } catch (e) {}
        }

        for (const folder of activeFolders) {
            const dirHandle = await state.projectHandle.getDirectoryHandle(folder, { create: true });
            const catAnnotations = folderMap[folder]; 
            const nameParts = file.name.split('.'); nameParts.pop(); 
            const baseName = nameParts.join('.');

            if (finalImageData) {
                try {
                    const origHandle = await dirHandle.getFileHandle(file.name, { create: true });
                    const origWritable = await origHandle.createWritable();
                    await origWritable.write(finalImageData);
                    await origWritable.close();
                    state.imageFiles[i] = await origHandle.getFile(); 
                } catch (e) { console.error(e); }
            }

            if (imgObj) {
                const tempCanvas = document.createElement('canvas'); tempCanvas.width = imgObj.width; tempCanvas.height = imgObj.height;
                const tempCtx = tempCanvas.getContext('2d'); tempCtx.drawImage(imgObj, 0, 0);

                const tBrush = document.createElement('canvas'); tBrush.width = imgObj.width; tBrush.height = imgObj.height;
                const tbCtx = tBrush.getContext('2d');

                catAnnotations.forEach(ann => {
                    if (ann.type === 'brush' || ann.type === 'erase') {
                        if (!ann.path || ann.path.length < 2) return;
                        tbCtx.beginPath(); tbCtx.moveTo(ann.path[0].x, ann.path[0].y);
                        for (let pt = 1; pt < ann.path.length; pt++) tbCtx.lineTo(ann.path[pt].x, ann.path[pt].y);
                        tbCtx.lineCap = 'round'; tbCtx.lineJoin = 'round'; tbCtx.lineWidth = ann.size;
                        
                        if (ann.type === 'erase') {
                            tbCtx.globalCompositeOperation = 'destination-out'; tbCtx.strokeStyle = 'rgba(0,0,0,1)'; tbCtx.stroke(); tbCtx.globalCompositeOperation = 'source-over';
                        } else { tbCtx.strokeStyle = ann.color; tbCtx.stroke(); }
                    }
                });
                
                tempCtx.globalAlpha = 0.3; tempCtx.drawImage(tBrush, 0, 0); tempCtx.globalAlpha = 1.0;

                catAnnotations.forEach(ann => {
                    if (ann.type === 'rect' || ann.type === 'circ' || ann.type === 'rectangle' || ann.type === 'circle') {
                        tempCtx.strokeStyle = ann.color; tempCtx.lineWidth = 2; tempCtx.beginPath();
                        if (ann.type === 'rect' || ann.type === 'rectangle') tempCtx.rect(ann.x, ann.y, ann.w, ann.h);
                        if (ann.type === 'circ' || ann.type === 'circle') tempCtx.arc(ann.x, ann.y, ann.r, 0, 2 * Math.PI);
                        tempCtx.stroke();
                    } else if (ann.type === 'mask') {
                        // FIXED: Safely check for a valid image element during save
                        if (ann.cachedImg && ann.cachedImg instanceof HTMLImageElement && ann.cachedImg.complete) { 
                            tempCtx.globalAlpha = 0.3; 
                            tempCtx.drawImage(ann.cachedImg, ann.x, ann.y); 
                            tempCtx.globalAlpha = 1.0; 
                        }
                    }
                });

                const bakedBlob = await new Promise(res => tempCanvas.toBlob(res, 'image/png'));
                const bakedHandle = await dirHandle.getFileHandle(`${baseName}_annotated.png`, { create: true });
                const bWrite = await bakedHandle.createWritable();
                await bWrite.write(bakedBlob);
                await bWrite.close();
                
                // --- NEW: YOLO and COCO EXPORTS ---
                let yoloText = "";
                let cocoArray = []; // COCO uses a JSON Array

                catAnnotations.forEach(ann => {
                    const b = getBounds(ann);
                    
                    // 1. Determine Class ID based on project categories array
                    let classId = state.projectMetadata.categories.indexOf(ann.label);
                    if (classId === -1 && ann.isText) classId = state.projectMetadata.categories.indexOf("Text OCR");
                    if (classId === -1) classId = 0; // Fallback

                    // 2. Ensure coordinates don't go outside image boundaries
                    const safeX = Math.max(0, b.x);
                    const safeY = Math.max(0, b.y);
                    const safeW = Math.min(imgObj.width - safeX, b.w);
                    const safeH = Math.min(imgObj.height - safeY, b.h);

                    // 3. YOLO Format: <class_id> <x_center> <y_center> <width> <height> (Normalized 0 to 1)
                    const xCenter = (safeX + safeW / 2) / imgObj.width;
                    const yCenter = (safeY + safeH / 2) / imgObj.height;
                    const normW = safeW / imgObj.width;
                    const normH = safeH / imgObj.height;
                    yoloText += `${classId} ${xCenter.toFixed(6)} ${yCenter.toFixed(6)} ${normW.toFixed(6)} ${normH.toFixed(6)}\n`;
                    
                    // 4. COCO Format (JSON Object): { "category_id": id, "bbox": [x, y, w, h] }
                    cocoArray.push({
                        category_id: classId,
                        bbox: [Math.round(safeX), Math.round(safeY), Math.round(safeW), Math.round(safeH)]
                    });
                });

                // Export YOLO (.txt)
                if (yoloText) {
                    const yoloHandle = await dirHandle.getFileHandle(`${baseName}_yolo.txt`, { create: true });
                    const yWrite = await yoloHandle.createWritable();
                    await yWrite.write(yoloText);
                    await yWrite.close();
                }

                // Export COCO (.json)
                if (cocoArray.length > 0) {
                    const cocoHandle = await dirHandle.getFileHandle(`${baseName}_coco.json`, { create: true });
                    const cWrite = await cocoHandle.createWritable();
                    await cWrite.write(JSON.stringify(cocoArray, null, 2));
                    await cWrite.close();
                }
            } 
            
            // --- RESTORED: Custom Annotator JSON Output ---
            // This runs regardless of whether the image could be visually loaded
            const textData = JSON.stringify(catAnnotations, null, 2);
            const textHandle = await dirHandle.getFileHandle(`${baseName}.json`, { create: true });
            const tWrite = await textHandle.createWritable();
            await tWrite.write(textData);
            await tWrite.close();
        }

        // 5. Store Master Array in Memory
        state.projectMetadata.imageLabels = state.projectMetadata.imageLabels || {};
        state.projectMetadata.imageLabels[file.name] = annotations; 
        state.savedHistoryStep[i] = state.historyStep[i];
        savedCount++;
    });

    await Promise.all(savePromises);

    let didDeleteFolders = false;
    if (state.pendingDeletions && state.pendingDeletions.length > 0) {
        for (const delCat of state.pendingDeletions) {
            try { await state.projectHandle.removeEntry(delCat, { recursive: true }); } 
            catch (err) { console.warn("Could not delete folder:", delCat); }
        }
        state.pendingDeletions = [];
        didDeleteFolders = true;
    }

    if (savedCount > 0 || didDeleteFolders) {
        try {
            const dlaHandle = await state.projectHandle.getFileHandle('metadata.dla', { create: true });
            const writable = await dlaHandle.createWritable();
            await writable.write(JSON.stringify(state.projectMetadata));
            await writable.close();
            
            // NEW: Export a master classes.txt file for your ML Pipeline
            const classHandle = await state.projectHandle.getFileHandle('classes.txt', { create: true });
            const classWrite = await classHandle.createWritable();
            await classWrite.write(state.projectMetadata.categories.join('\n'));
            await classWrite.close();
            
        } catch (e) { console.error(e); }
    }

    state.saveRequired = false; 
    btnSaveMain.textContent = "Save Data"; btnSaveMain.disabled = false;
    
    if (didDeleteFolders) return -2; 
    return savedCount;
}

document.getElementById('btn-save').addEventListener('click', async () => {
    if (!state.saveRequired) { alert("No unsaved changes."); return; }
    const count = await saveAllData();
    
    if (count === -2) {
        alert("Categories deleted and changes saved. Reloading the project to synchronize files.");
        window.location.reload(); 
    }
    else if (count === -1) alert("No unsaved changes detected.");
    else if (count >= 0) alert(`Saved successfully! Processed ${count} modified image(s).`);
});

document.getElementById('btn-close-project').addEventListener('click', async () => {
    let hasUnsaved = false;
    if (state.pendingDeletions && state.pendingDeletions.length > 0) hasUnsaved = true;
    for (let i = 0; i < state.imageFiles.length; i++) {
        if (state.historyStep[i] !== state.savedHistoryStep[i]) hasUnsaved = true;
    }

    if (hasUnsaved) {
        const count = await saveAllData(); 
        if (count === -2) { window.location.reload(); return; }
    }
    
    abortActiveDrawing(); 
    state.projectHandle = null; state.projectMetadata = { categories: [], folders: [], categoryColors: {} }; state.imageFiles = [];
    state.currentImageIndex = -1; state.currentImageObj = null; state.baseCanvas = null; state.annotations = {}; state.history = {}; state.historyStep = {}; state.savedHistoryStep = {}; state.activeCategory = 'create-new'; state.saveRequired = false;
    
    document.getElementById('app').style.display = 'none'; document.getElementById('landing-page').style.display = 'flex';
    document.getElementById('image-list').innerHTML = '<div style="padding: 15px;"><i style="color: var(--text-muted);">No images available.</i></div>';
    document.getElementById('project-tree').innerHTML = '<i style="color: var(--text-muted);">No project loaded.</i>';
    
    ctx.clearRect(0, 0, canvas.width, canvas.height); canvas.style.display = 'none'; document.getElementById('upload-overlay').style.display = 'flex';
});