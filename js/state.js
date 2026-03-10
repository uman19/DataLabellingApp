export const state = {
    projectHandle: null,
    projectMetadata: { categories: [], folders: [] },
    imageFiles: [],
    currentImageIndex: -1,
    currentImageObj: null,
    currentScale: 1,
    
    // Toolbar State
    currentTool: 'draw', 
    currentShape: 'rectangle',
    currentColor: '#00ff00',
    brushSize: 15, // NEW: Default brush size
    showLabels: true,
    
    annotations: {},
    selectedAnnotations: [], 
    resizeSelection: null,
    
    // NEW: Undo/Redo State
    history: {},      // Stores arrays of snapshots per image index
    historyStep: {},   // Tracks the current position in the history stack per image

    activeCategory: 'create-new'
};