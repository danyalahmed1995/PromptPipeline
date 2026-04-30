# Prompt Pipeline Extension

A generic ChatGPT code feeder extension to help you upload folder contents in chunks.

## Features
- Select a folder to process.
- Filters files by extension and excludes common build/system folders.
- Redacts common secret patterns (API keys, tokens, etc.).
- Chunks large files into ~12,000 character pieces.
- Copy chunks sequentially with a single click.
- Supports templates: Bug Report, Explain Code, Refactor Suggestions.

## Tech Stack
- React + TypeScript
- Vite
- Chrome Manifest V3

## Local Setup

### 1. Install Dependencies
```bash
npm install
```

### 2. Build the Extension
```bash
npm run build
```
This will create a `dist` folder.

### 3. Load in Chrome
1. Open Chrome and navigate to `chrome://extensions/`.
2. Enable **Developer mode** (toggle in the top right).
3. Click **Load unpacked**.
4. Select the `dist` folder in this project directory.

## Usage
1. Click the extension icon in your browser.
2. Click **Select Folder** and choose the project folder you want to feed to ChatGPT.
3. Select a **Template** from the dropdown.
4. Click **Copy Next Chunk** to copy the first piece to your clipboard.
5. Paste into ChatGPT.
6. Repeat until all chunks are copied.
