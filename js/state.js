export const state = {
    projectHandle: null,
    projectMetadata: { categories: [], folders: [], categoryColors: {} }, // Req 8
    imageFiles: [],
    currentImageIndex: -1,
    currentImageObj: null,
    baseCanvas: null, // Req 10: Holds the actual image data so we can permanently blur it
    currentScale: 1,
    
    // Toolbar State
    currentTool: 'rect', // Req 4: Split tools
    currentColor: '#00ff00',
    brushSize: 15,
    showLabels: true,
    textMode: false, // Req 9
    
    annotations: {},
    selectedAnnotations: [], 
    resizeSelection: null,
    hiddenCategories: [], // Req 7
    
    // Undo/Redo State
    history: {},      
    historyStep: {},
    savedHistoryStep: {},

    pendingDeletions: [],

    activeCategory: 'create-new',

    hiddenCategories: [], 
    hideThreshold: 0,

};