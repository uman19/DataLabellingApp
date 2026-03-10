import { state } from './state.js';
import { canvas, ctx, redrawCanvas, setupCanvasEvents, updateCursor, resizeOffscreenCanvas, saveHistory, undo, redo, updateProjectTreeUI } from './canvasEngine.js';
// --- Theme Toggle Logic ---
const themeBtn = document.getElementById('btn-theme-toggle');
const currentTheme = localStorage.getItem('annotator-theme') || 'dark';

if (currentTheme === 'light') {
    document.documentElement.setAttribute('data-theme', 'light');
    themeBtn.textContent = '🌘 Dark Mode';
}

themeBtn.addEventListener('click', () => {
    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    if (isLight) {
        document.documentElement.removeAttribute('data-theme');
        localStorage.setItem('annotator-theme', 'dark');
        themeBtn.textContent = '☀️ Light Mode';
    } else {
        document.documentElement.setAttribute('data-theme', 'light');
        localStorage.setItem('annotator-theme', 'light');
        themeBtn.textContent = '🌘 Dark Mode';
    }
});


const DOM = {
    landingPage: document.getElementById('landing-page'),
    app: document.getElementById('app'),
    btnCreate: document.getElementById('btn-create-project'),
    btnOpen: document.getElementById('btn-open-project'),
    projectTree: document.getElementById('project-tree'),
    uploadOverlay: document.getElementById('upload-overlay'),
    fileInput: document.getElementById('file-input'),
    dropZone: document.getElementById('drop-zone'),
    imageListPanel: document.getElementById('image-list'),
    zoomSlider: document.getElementById('zoom-slider'),
    zoomVal: document.getElementById('zoom-val'),
    colorPicker: document.getElementById('color-picker'),
    toggleLabelsBtn: document.getElementById('btn-toggle-labels'),
    shapeRadio: document.querySelectorAll('input[name="shape"]'),
    toolIcons: document.querySelectorAll('.tool-icon') 
};

setupCanvasEvents();
updateCursor(); // Set initial cursor

// --- Toolbar Events ---
// --- Toolbar Events ---
DOM.toolIcons.forEach(icon => {
    icon.addEventListener('click', (e) => {
        DOM.toolIcons.forEach(ic => ic.classList.remove('active'));
        e.currentTarget.classList.add('active');
        state.currentTool = e.currentTarget.id.replace('tool-', '');
        updateCursor(); 
        
        // NEW: Disable shape radio buttons if the tool is not 'draw'
        DOM.shapeRadio.forEach(radio => {
            radio.disabled = state.currentTool !== 'draw';
        });

        // NEW: Clear selections when switching tools so highlights disappear
        if (state.currentTool !== 'select') state.selectedAnnotations = [];
        if (state.currentTool !== 'resize') state.resizeSelection = null;
        
        // Ensure we import redrawCanvas at the top of main.js if it's not already there
        redrawCanvas();
    });
});

// --- Top Bar Actions ---
document.getElementById('btn-reset').addEventListener('click', () => {
    if (state.currentImageIndex === -1) return;
    
    if (confirm("Are you sure you want to clear all labels and shapes for this image?")) {
        state.annotations[state.currentImageIndex] = [];
        saveHistory();
        redrawCanvas();
    }
});
// --- Right Panel Interactions ---
document.getElementById('project-tree').addEventListener('change', (e) => {
    if (e.target.name === 'category-select') {
        state.activeCategory = e.target.value;
    }
});

document.getElementById('btn-add-images').addEventListener('click', () => {
    document.getElementById('file-input').click(); // Opens system file dialogue
});
// --- Color Picker & Selection Styling ---
DOM.colorPicker.addEventListener('change', (e) => {
    state.currentColor = e.target.value;
    updateCursor(); 
    
    // NEW: Apply color to all selected items
    if (state.selectedAnnotations && state.selectedAnnotations.length > 0) {
        state.selectedAnnotations.forEach(ann => {
            if (ann.type !== 'erase') ann.color = state.currentColor;
        });
        saveHistory();
        redrawCanvas();
    }
});

DOM.toggleLabelsBtn.addEventListener('click', (e) => {
    state.showLabels = !state.showLabels;
    e.target.textContent = state.showLabels ? "Hide Labels" : "Show Labels";
    
    // Change button color to indicate it's disabled
    if (state.showLabels) e.target.classList.add('btn-secondary');
    else e.target.classList.remove('btn-secondary');
    
    redrawCanvas();
});

DOM.shapeRadio.forEach(radio => {
    radio.addEventListener('change', (e) => state.currentShape = e.target.value);
});

canvas.addEventListener('wheel', (e) => {
    if (state.currentTool !== 'brush') return;
    e.preventDefault(); 
    state.brushSize += e.deltaY < 0 ? 2 : -2;
    state.brushSize = Math.max(2, Math.min(state.brushSize, 100)); 
    updateCursor(); // Resizes the circular cursor dynamically
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
    } catch (error) { console.error("Cancelled or failed:", error); }
});

DOM.btnOpen.addEventListener('click', async () => {
    try {
        state.projectHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
        const dlaHandle = await state.projectHandle.getFileHandle('metadata.dla');
        const file = await dlaHandle.getFile();
        state.projectMetadata = JSON.parse(await file.text());
        
        initAppWorkspace();
        await loadExistingProjectData(); // <-- NEW: Load images and labels

    } catch (error) { 
        console.error(error);
        alert("Could not find metadata.dla. Is this a valid project folder?"); 
    }
});

// NEW: Helper function to scan folders, load images, and restore labels
async function loadExistingProjectData() {
    state.imageFiles = [];
    state.annotations = {};
    const loadedImageNames = new Set();
    
    // Helper to read a JSON file if Option 2 was used
    async function getJsonAnnotations(dirHandle, baseName) {
        try {
            const jsonHandle = await dirHandle.getFileHandle(`${baseName}.json`);
            const file = await jsonHandle.getFile();
            return JSON.parse(await file.text());
        } catch (e) {
            return null; // No JSON file found
        }
    }

    // Loop through all known categories
    for (const cat of state.projectMetadata.categories) {
        try {
            const catDirHandle = await state.projectHandle.getDirectoryHandle(cat);
            
            // Loop through all files inside the category folder
            for await (const entry of catDirHandle.values()) {
                // Check if it's an image (and skip the "baked" annotated copies)
                if (entry.kind === 'file' && entry.name.match(/\.(png|jpe?g|webp)$/i) && !entry.name.includes('_annotated')) {
                    
                    // Prevent loading the same image twice if it's in multiple categories
                    if (!loadedImageNames.has(entry.name)) {
                        loadedImageNames.add(entry.name);
                        
                        const file = await entry.getFile();
                        state.imageFiles.push(file);
                        const newIndex = state.imageFiles.length - 1;
                        
                        // Extract base name (e.g., "car.png" -> "car")
                        const baseName = entry.name.substring(0, entry.name.lastIndexOf('.'));
                        let restoredAnns = [];
                        
                        // Check Option 3: Did we save to the .dla metadata?
                        if (state.projectMetadata.imageLabels && state.projectMetadata.imageLabels[entry.name]) {
                            restoredAnns = state.projectMetadata.imageLabels[entry.name];
                        } 
                        // Check Option 2: Is there a separate .json file?
                        else {
                            const jsonAnns = await getJsonAnnotations(catDirHandle, baseName);
                            if (jsonAnns) restoredAnns = jsonAnns;
                        }
                        
                        // Assign the recovered labels to the image index
                        state.annotations[newIndex] = restoredAnns;
                    }
                }
            }
        } catch (err) {
            console.warn(`Could not read category folder: ${cat}`, err);
        }
    }

    // Refresh UI
    updateImagePanel();
    if (state.imageFiles.length > 0) {
        loadImageOntoCanvas(0);
    }
}

function initAppWorkspace() {
    DOM.landingPage.style.display = 'none';
    DOM.app.style.display = 'flex';
    updateProjectTreeUI();
}

// --- Image Handling ---
DOM.uploadOverlay.addEventListener('click', () => DOM.fileInput.click());
DOM.fileInput.addEventListener('change', (e) => { handleNewFiles(e.target.files); DOM.fileInput.value = ''; });
DOM.dropZone.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); });
DOM.dropZone.addEventListener('drop', (e) => {
    e.preventDefault(); e.stopPropagation();
    if (e.dataTransfer.files.length > 0) handleNewFiles(e.dataTransfer.files);
});

function handleNewFiles(files) {
    let added = false;
    for (let i = 0; i < files.length; i++) {
        if (files[i].type.startsWith('image/')) {
            state.imageFiles.push(files[i]);
            added = true;
        }
    }
    if (added) {
        updateImagePanel();
        if (state.currentImageIndex === -1) loadImageOntoCanvas(0);
    }
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
    state.currentImageIndex = index;
    const file = state.imageFiles[index];
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    
    img.onload = () => {
        state.currentImageObj = img;
        DOM.uploadOverlay.style.display = 'none';
        canvas.style.display = 'inline-block';
        
        canvas.width = img.width;
        canvas.height = img.height;
        canvas.style.width = (img.width * state.currentScale) + 'px';
        canvas.style.height = (img.height * state.currentScale) + 'px';
        resizeOffscreenCanvas(img.width, img.height); // Sync annotation layer size
        
        // NEW: Initialize history for this image if it doesn't exist yet
        if (!state.history[index]) {
            state.history[index] = [JSON.parse(JSON.stringify(state.annotations[index] || []))];
            state.historyStep[index] = 0;
        }

        redrawCanvas();
        updateImagePanel();
        URL.revokeObjectURL(objectUrl);
    };
    img.src = objectUrl;
}

// --- Navigation & Viewport ---
window.addEventListener('keydown', (e) => {
    
    // Undo (Ctrl+Z or Cmd+Z)
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
        return;
    }
    
    // Redo (Ctrl+Y or Cmd+Y or Ctrl+Shift+Z)
    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        redo();
        return;
    }
    
    // NEW: Delete selected items
    if ((e.key === 'Delete' || e.key === 'Backspace') && state.selectedAnnotations.length > 0) {
        const anns = state.annotations[state.currentImageIndex];
        // Keep only annotations that are NOT in the selected array
        state.annotations[state.currentImageIndex] = anns.filter(a => !state.selectedAnnotations.includes(a));
        state.selectedAnnotations = []; // Clear selection
        saveHistory();
        redrawCanvas();
        return;
    }

    // Existing navigation logic
    if (state.currentImageIndex !== -1 && e.target.tagName !== 'INPUT') {
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') loadImageOntoCanvas(state.currentImageIndex + 1);
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') loadImageOntoCanvas(state.currentImageIndex - 1);
    }
});

DOM.zoomSlider.addEventListener('input', (e) => {
    state.currentScale = e.target.value / 100;
    DOM.zoomVal.innerText = `${e.target.value}%`;
    
    // FIX: Update actual CSS dimensions so scrollbars work perfectly on mobile
    if (state.currentImageObj) {
        canvas.style.width = (state.currentImageObj.width * state.currentScale) + 'px';
        canvas.style.height = (state.currentImageObj.height * state.currentScale) + 'px';
    }
    
    updateCursor(); 
});

// --- Resizer / Splitter Logic ---
const resizerLeft = document.getElementById('resizer-left');
const resizerRight = document.getElementById('resizer-right');
const leftPanel = document.querySelector('.left-tools');
const rightPanel = document.querySelector('.right-panels');

let isResizingLeft = false;
let isResizingRight = false;

resizerLeft.addEventListener('mousedown', (e) => {
    isResizingLeft = true;
    document.body.style.cursor = 'col-resize';
    resizerLeft.classList.add('resizing');
    e.preventDefault(); // Prevent text selection
});

resizerRight.addEventListener('mousedown', (e) => {
    isResizingRight = true;
    document.body.style.cursor = 'col-resize';
    resizerRight.classList.add('resizing');
    e.preventDefault(); // Prevent text selection
});

window.addEventListener('mousemove', (e) => {
    if (!isResizingLeft && !isResizingRight) return;
    
    // Prevent default to stop weird selection glitches while dragging
    e.preventDefault();

    if (isResizingLeft) {
        // Calculate new width (mouse X position relative to left edge)
        const newWidth = e.clientX;
        // Constrain width between 60px and 300px
        if (newWidth >= 60 && newWidth <= 300) {
            leftPanel.style.width = `${newWidth}px`;
        }
    }

    if (isResizingRight) {
        // Calculate new width (total window width minus mouse X position)
        const newWidth = window.innerWidth - e.clientX;
        // Constrain width between 150px and 600px
        if (newWidth >= 150 && newWidth <= 600) {
            rightPanel.style.width = `${newWidth}px`;
        }
    }
});

window.addEventListener('mouseup', () => {
    if (isResizingLeft || isResizingRight) {
        isResizingLeft = false;
        isResizingRight = false;
        document.body.style.cursor = ''; // Reset to default
        resizerLeft.classList.remove('resizing');
        resizerRight.classList.remove('resizing');
    }
});

// --- Save Logic ---
// const DOMSave = {
//     modal: document.getElementById('save-modal'),
//     btnSaveMain: document.getElementById('btn-save'),
//     btnConfirm: document.getElementById('btn-confirm-save'),
//     btnCancel: document.getElementById('btn-cancel-save'),
//     radios: document.querySelectorAll('input[name="save-type"]')
// };

// DOMSave.btnSaveMain.addEventListener('click', () => {
//     if (state.currentImageIndex === -1) return;
//     const annotations = state.annotations[state.currentImageIndex] || [];
//     if (annotations.length === 0) {
//         alert("No labels to save on this image!");
//         return;
//     }
//     DOMSave.modal.style.display = 'flex';
// });

// DOMSave.btnCancel.addEventListener('click', () => DOMSave.modal.style.display = 'none');

// DOMSave.btnConfirm.addEventListener('click', async () => {
//     DOMSave.modal.style.display = 'none';
//     if (!state.projectHandle) {
//         alert("No project folder linked. Please create or open a project first.");
//         return;
//     }

//     let saveType = 'baked';
//     DOMSave.radios.forEach(r => { if (r.checked) saveType = r.value; });

//     let savedCount = 0;
    
//     // Process ALL images, but skip ones without labels
//     for (let i = 0; i < state.imageFiles.length; i++) {
//         const file = state.imageFiles[i];
//         const annotations = state.annotations[i] || [];

//         // 1. Skip if no labels exist on this image
//         if (annotations.length === 0) continue;

//         // 2. Find unique categories used in THIS specific image
//         const activeCategories = [...new Set(annotations.filter(a => a.label).map(a => a.label))];
//         if (activeCategories.length === 0) continue;

//         // Load original file data. Catch errors if the file reference went stale.
//         let fileData = null;
//         try {
//             fileData = await file.arrayBuffer();
//         } catch (err) {
//             console.warn(`Could not read file ${file.name}. It may already be saved to disk.`);
//         }

//         // We need an Image object to draw the baked Option 1 images in the background
//         let imgObj = null;
//         if (saveType === 'baked') {
//             if (i === state.currentImageIndex) {
//                 imgObj = state.currentImageObj; // Already loaded on canvas
//             } else if (fileData) {
//                 try {
//                     const blob = new Blob([fileData], { type: file.type });
//                     imgObj = await createImageBitmap(blob);
//                 } catch (e) { console.warn("Failed to generate image bitmap for baking."); }
//             }
//         }

//         // 3. Loop through categories and save isolated data
//         for (const cat of activeCategories) {
//             const dirHandle = await state.projectHandle.getDirectoryHandle(cat, { create: true });
            
//             // ISOLATE ANNOTATIONS: Only grab labels for THIS category (and include erasers)
//             const catAnnotations = annotations.filter(a => a.label === cat || a.type === 'erase');

//             // Write Original Image (if we successfully read it)
//             if (fileData) {
//                 try {
//                     const origHandle = await dirHandle.getFileHandle(file.name, { create: true });
//                     const origWritable = await origHandle.createWritable();
//                     await origWritable.write(fileData);
//                     await origWritable.close();
                    
//                     // CRITICAL FIX for NotReadableError: 
//                     // Update the state with a fresh file reference so it doesn't go stale!
//                     state.imageFiles[i] = await origHandle.getFile(); 
//                 } catch (e) {
//                     console.error("Failed to write original image:", e);
//                 }
//             }

//             const nameParts = file.name.split('.');
//             nameParts.pop(); 
//             const baseName = nameParts.join('.');

//             // Option 1: Bake ONLY this category's labels into the image
//             if (saveType === 'baked' && imgObj) {
//                 const tempCanvas = document.createElement('canvas');
//                 tempCanvas.width = imgObj.width; tempCanvas.height = imgObj.height;
//                 const tempCtx = tempCanvas.getContext('2d');
//                 tempCtx.drawImage(imgObj, 0, 0);

//                 // Recreate brush & eraser layers for the background rendering
//                 const tBrush = document.createElement('canvas');
//                 tBrush.width = imgObj.width; tBrush.height = imgObj.height;
//                 const tbCtx = tBrush.getContext('2d');

//                 catAnnotations.forEach(ann => {
//                     if (ann.type === 'brush' || ann.type === 'erase') {
//                         if (ann.path.length < 2) return;
//                         tbCtx.beginPath(); tbCtx.moveTo(ann.path[0].x, ann.path[0].y);
//                         for (let pt = 1; pt < ann.path.length; pt++) tbCtx.lineTo(ann.path[pt].x, ann.path[pt].y);
//                         tbCtx.lineCap = 'round'; tbCtx.lineJoin = 'round'; tbCtx.lineWidth = ann.size;
                        
//                         if (ann.type === 'erase') {
//                             tbCtx.globalCompositeOperation = 'destination-out';
//                             tbCtx.strokeStyle = 'rgba(0,0,0,1)';
//                             tbCtx.stroke();
//                             tbCtx.globalCompositeOperation = 'source-over';
//                         } else {
//                             tbCtx.strokeStyle = ann.color;
//                             tbCtx.stroke();
//                         }
//                     }
//                 });
//                 tempCtx.drawImage(tBrush, 0, 0);

//                 // Draw standard shapes
//                 catAnnotations.forEach(ann => {
//                     if (ann.type === 'rectangle' || ann.type === 'circle') {
//                         tempCtx.strokeStyle = ann.color; tempCtx.lineWidth = 2; tempCtx.beginPath();
//                         if (ann.type === 'rectangle') tempCtx.rect(ann.x, ann.y, ann.w, ann.h);
//                         if (ann.type === 'circle') tempCtx.arc(ann.x, ann.y, ann.r, 0, 2 * Math.PI);
//                         tempCtx.stroke();
//                         tempCtx.fillStyle = ann.color; tempCtx.font = '16px Arial';
//                         tempCtx.fillText(ann.label, ann.x, ann.y > 20 ? ann.y - 8 : ann.y + 20);
//                     } else if (ann.type === 'brush') {
//                         tempCtx.fillStyle = ann.color; tempCtx.font = '16px Arial';
//                         tempCtx.fillText(ann.label, ann.path[0].x, ann.path[0].y - 10);
//                     }
//                 });

//                 const bakedBlob = await new Promise(res => tempCanvas.toBlob(res, 'image/png'));
//                 const bakedHandle = await dirHandle.getFileHandle(`${baseName}_annotated.png`, { create: true });
//                 const bWrite = await bakedHandle.createWritable();
//                 await bWrite.write(bakedBlob);
//                 await bWrite.close();
//             } 
//             // Option 2: Save JSON for this category only
//             else if (saveType === 'text') {
//                 const textData = JSON.stringify(catAnnotations, null, 2);
//                 const textHandle = await dirHandle.getFileHandle(`${baseName}.json`, { create: true });
//                 const tWrite = await textHandle.createWritable();
//                 await tWrite.write(textData);
//                 await tWrite.close();
//             }
//         }

//         // Option 3 / Universal Metadata logic: Always store the master label data in the .dla file
//         state.projectMetadata.imageLabels = state.projectMetadata.imageLabels || {};
//         state.projectMetadata.imageLabels[file.name] = annotations; 
        
//         savedCount++;
//     }

//     // Write the unified metadata.dla file once at the very end
//     if (savedCount > 0) {
//         try {
//             const dlaHandle = await state.projectHandle.getFileHandle('metadata.dla', { create: true });
//             const writable = await dlaHandle.createWritable();
//             await writable.write(JSON.stringify(state.projectMetadata));
//             await writable.close();
            
//             alert(`Saved successfully! Exported data for ${savedCount} labeled image(s).`);
//         } catch (e) {
//             console.error("Could not write metadata.dla", e);
//             alert("Images saved, but failed to update project metadata.");
//         }
//     } else {
//         alert("No labeled images found to save.");
//     }
// });
// --- Save Logic (Save All Formats Automatically) ---
// --- Save Logic & Project Closing ---
async function saveAllData() {
    if (!state.projectHandle) return;

    const btnSaveMain = document.getElementById('btn-save');
    btnSaveMain.textContent = "Saving...";
    btnSaveMain.disabled = true;

    let savedCount = 0;
    
    for (let i = 0; i < state.imageFiles.length; i++) {
        const file = state.imageFiles[i];
        const annotations = state.annotations[i] || [];

        if (annotations.length === 0) continue;
        const activeCategories = [...new Set(annotations.filter(a => a.label).map(a => a.label))];
        if (activeCategories.length === 0) continue;

        let fileData = null;
        try { fileData = await file.arrayBuffer(); } catch (err) {}

        let imgObj = null;
        if (i === state.currentImageIndex) {
            imgObj = state.currentImageObj;
        } else if (fileData) {
            try {
                const blob = new Blob([fileData], { type: file.type });
                imgObj = await createImageBitmap(blob);
            } catch (e) {}
        }

        for (const cat of activeCategories) {
            const dirHandle = await state.projectHandle.getDirectoryHandle(cat, { create: true });
            const catAnnotations = annotations.filter(a => a.label === cat || a.type === 'erase');
            const nameParts = file.name.split('.'); nameParts.pop(); 
            const baseName = nameParts.join('.');

            if (fileData) {
                try {
                    const origHandle = await dirHandle.getFileHandle(file.name, { create: true });
                    const origWritable = await origHandle.createWritable();
                    await origWritable.write(fileData);
                    await origWritable.close();
                    state.imageFiles[i] = await origHandle.getFile(); 
                } catch (e) { console.error(e); }
            }

            if (imgObj) {
                const tempCanvas = document.createElement('canvas');
                tempCanvas.width = imgObj.width; tempCanvas.height = imgObj.height;
                const tempCtx = tempCanvas.getContext('2d');
                tempCtx.drawImage(imgObj, 0, 0);

                const tBrush = document.createElement('canvas');
                tBrush.width = imgObj.width; tBrush.height = imgObj.height;
                const tbCtx = tBrush.getContext('2d');

                catAnnotations.forEach(ann => {
                    if (ann.type === 'brush' || ann.type === 'erase') {
                        if (ann.path.length < 2) return;
                        tbCtx.beginPath(); tbCtx.moveTo(ann.path[0].x, ann.path[0].y);
                        for (let pt = 1; pt < ann.path.length; pt++) tbCtx.lineTo(ann.path[pt].x, ann.path[pt].y);
                        tbCtx.lineCap = 'round'; tbCtx.lineJoin = 'round'; tbCtx.lineWidth = ann.size;
                        
                        if (ann.type === 'erase') {
                            tbCtx.globalCompositeOperation = 'destination-out';
                            tbCtx.strokeStyle = 'rgba(0,0,0,1)';
                            tbCtx.stroke();
                            tbCtx.globalCompositeOperation = 'source-over';
                        } else { tbCtx.strokeStyle = ann.color; tbCtx.stroke(); }
                    }
                });
                tempCtx.drawImage(tBrush, 0, 0);

                catAnnotations.forEach(ann => {
                    if (ann.type === 'rectangle' || ann.type === 'circle') {
                        tempCtx.strokeStyle = ann.color; tempCtx.lineWidth = 2; tempCtx.beginPath();
                        if (ann.type === 'rectangle') tempCtx.rect(ann.x, ann.y, ann.w, ann.h);
                        if (ann.type === 'circle') tempCtx.arc(ann.x, ann.y, ann.r, 0, 2 * Math.PI);
                        tempCtx.stroke();
                        tempCtx.fillStyle = ann.color; tempCtx.font = '16px Arial';
                        tempCtx.fillText(ann.label, ann.x, ann.y > 20 ? ann.y - 8 : ann.y + 20);
                    } else if (ann.type === 'brush') {
                        tempCtx.fillStyle = ann.color; tempCtx.font = '16px Arial';
                        tempCtx.fillText(ann.label, ann.path[0].x, ann.path[0].y - 10);
                    }
                });

                const bakedBlob = await new Promise(res => tempCanvas.toBlob(res, 'image/png'));
                const bakedHandle = await dirHandle.getFileHandle(`${baseName}_annotated.png`, { create: true });
                const bWrite = await bakedHandle.createWritable();
                await bWrite.write(bakedBlob);
                await bWrite.close();
            } 
            
            const textData = JSON.stringify(catAnnotations, null, 2);
            const textHandle = await dirHandle.getFileHandle(`${baseName}.json`, { create: true });
            const tWrite = await textHandle.createWritable();
            await tWrite.write(textData);
            await tWrite.close();
        }

        state.projectMetadata.imageLabels = state.projectMetadata.imageLabels || {};
        state.projectMetadata.imageLabels[file.name] = annotations; 
        savedCount++;
    }

    if (savedCount > 0) {
        try {
            const dlaHandle = await state.projectHandle.getFileHandle('metadata.dla', { create: true });
            const writable = await dlaHandle.createWritable();
            await writable.write(JSON.stringify(state.projectMetadata));
            await writable.close();
        } catch (e) { console.error(e); }
    }

    btnSaveMain.textContent = "Save Data";
    btnSaveMain.disabled = false;
    return savedCount; // Return count so UI can decide to alert
}

// Attach to UI Save Button
document.getElementById('btn-save').addEventListener('click', async () => {
    const count = await saveAllData();
    if (count > 0) alert(`Saved successfully! Exported ALL formats for ${count} labeled image(s).`);
    else alert("No labeled images found to save.");
});

// NEW: Close Project & Reset
document.getElementById('btn-close-project').addEventListener('click', async () => {
    await saveAllData(); // Silently save any pending changes
    
    // Wipe memory
    state.projectHandle = null;
    state.projectMetadata = { categories: [], folders: [] };
    state.imageFiles = [];
    state.currentImageIndex = -1;
    state.currentImageObj = null;
    state.annotations = {};
    state.history = {};
    state.historyStep = {};
    state.activeCategory = 'create-new';
    
    // Reset UI
    document.getElementById('app').style.display = 'none';
    document.getElementById('landing-page').style.display = 'flex';
    document.getElementById('image-list').innerHTML = '<div style="padding: 15px;"><i style="color: var(--text-muted);">No images available.</i></div>';
    document.getElementById('project-tree').innerHTML = '<i style="color: var(--text-muted);">No project loaded.</i>';
    
    // Clear canvas visually
    const canvas = document.getElementById('main-canvas');
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    canvas.style.display = 'none';
    document.getElementById('upload-overlay').style.display = 'flex';
});