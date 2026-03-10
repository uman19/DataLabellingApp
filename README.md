# DataLabellingApp
Image annotator for creating dataset for ai/ machine learning

# 🏷️ Local AI Annotator

A blazing-fast, lightweight (< 100MB footprint), zero-dependency browser application for creating image datasets for AI training. 

Built entirely with native HTML5 Canvas and vanilla JavaScript, this tool leverages the modern **File System Access API** to read, write, and organize your files directly on your local hard drive—no cloud storage, no backend server, and no complex installations required.

## ✨ Key Features

* **100% Local & Secure:** All images and label data stay on your machine.
* **Smart Data Export:** Automatically isolates and saves your labeled images into category-specific folders to easily pipe into your ML training pipelines.
* **Three Output Formats:** Silently generates and saves 3 formats simultaneously:
  1. `_annotated.png`: A "baked" visual mask of your labels.
  2. `.json`: Raw mathematical coordinates, bounding boxes, and brush paths.
  3. `.dla`: Internal metadata for easy project reloading and editing.
* **Rich Annotation Tools:**
  * **Draw:** Bounding boxes (Rectangles) and Circles.
  * **Brush:** Freehand painting for complex segmentation masks.
  * **Select & Resize:** Object selection with center-anchored bounding box resizing.
  * **Erase:** Object-level deletion or pixel-perfect brush stroke erasing.
* **Streamlined Workflow:** Auto-labeling via radio buttons, multi-image drag-and-drop, and bulk saving.
* **Modern UI:** Resizable panels, Dark/Light mode toggle, custom dynamic cursors, and full Undo/Redo history.

## 🚀 How to Use

*Note: Because this app uses the local File System Access API, it is best experienced on Chromium-based browsers (Google Chrome, Microsoft Edge, Brave, etc.).*

1. **Start a Project:** Click "Create New Project" and select a folder on your computer.
2. **Add Images:** Drag and drop images into the center canvas, or click the "Add ➕" button in the right panel.
3. **Create Categories:** Select "Create New..." in the Solution Explorer, draw a shape, and give it a name (e.g., "Apple").
4. **Annotate:** Keep drawing! Select existing radio buttons to automatically apply that label to your next shapes or brush strokes.
5. **Save:** Click "Save Data". The app will automatically create folders for your categories and distribute the images, JSON files, and masks into them!

## ⌨️ Keyboard Shortcuts

* `Arrow Right` / `Arrow Down`: Next Image
* `Arrow Left` / `Arrow Up`: Previous Image
* `Delete` / `Backspace`: Delete selected object(s)
* `Ctrl + Z` (or `Cmd + Z`): Undo
* `Ctrl + Y` (or `Cmd + Shift + Z`): Redo

## 🛠️ Tech Stack
* **Frontend:** HTML5, CSS3 (CSS Variables for theming), Vanilla JavaScript (ES6 Modules).
* **Rendering:** HTML5 `<canvas>` API with offscreen buffering for non-destructive editing.
* **Storage:** Browser `FileSystemDirectoryHandle` API.

## 🤖 Acknowledgments

This project was conceptualized and developed with the programming and architectural assistance of **Google's Gemini AI**. 

## 📝 License
[MIT License](LICENSE)
