import React, { useEffect, useState, useRef } from 'react';
import JSZip from 'jszip';
import { processFiles, generateBundles, ProcessedFile, SkipStats } from './fileProcessor';
import {
  TEMPLATE_MAPPING,
  TemplateType,
  loadPromptPipelineConfig,
  type PromptPipelineConfig
} from './constants';
import './App.css';

function App() {
  const [files, setFiles] = useState<ProcessedFile[]>([]);
  const [skipStats, setSkipStats] = useState<SkipStats>({
    total: 0,
    byReason: {},
    byExtension: {}
  });

  const [config, setConfig] = useState<PromptPipelineConfig | null>(null);
  const [projectName, setProjectName] = useState<string>('PromptPipeline');
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateType>('Bug Report');
  const [includeJson, setIncludeJson] = useState(false);
  const [includeMd, setIncludeMd] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [splitFiles, setSplitFiles] = useState(true);
  const [maxSizeMB, setMaxSizeMB] = useState(1.5);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadPromptPipelineConfig().then(setConfig);
  }, []);

  const getProjectName = (files: FileList): string => {
    if (files.length === 0) return 'PromptPipeline';
    const firstFile = files[0];
    const path = (firstFile as any).webkitRelativePath || firstFile.name;
    const segments = path.split('/');
    if (segments.length > 1) {
      return sanitizeFileName(segments[0]);
    }
    return 'PromptPipeline';
  };

  const handleFolderSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = event.target.files;
    if (!selectedFiles) return;

    setIsProcessing(true);
    setProjectName(getProjectName(selectedFiles));

    try {
      const { processed, skipStats: stats } = await processFiles(selectedFiles, {
        includeJson,
        includeMd,
        config: config ?? undefined
      });

      setFiles(processed);
      setSkipStats(stats);
    } catch (error) {
      console.error('Error processing files:', error);
      alert('Error processing files. See console for details.');
    } finally {
      setIsProcessing(false);
    }
  };

  const generateReadme = () => {
    return `${projectName} Work Package

Analyze the uploaded work package using ONLY the included instruction file and bundle files. Follow the instruction file strictly. Generate the requested output and return it as a complete downloadable .md file.
`;
  };

const handleDownloadWorkPackage = async () => {
  if (files.length === 0) {
    alert("No valid files found after filtering.");
    return;
  }

  const zip = new JSZip();

  // 1. Load Instruction File (fail loudly if missing)
  const instructionFileName = TEMPLATE_MAPPING[selectedTemplate];

  let instructionText = '';

  try {
    const response = await fetch(`./instructions/${instructionFileName}`);

    if (!response.ok) {
      console.error(`Failed to fetch: ./instructions/${instructionFileName}`);
      alert(`Instruction file missing or failed to load:\n${instructionFileName}`);
      return; //  STOP everything
    }

    instructionText = await response.text();
  } catch (error) {
    console.error('Error loading instruction file:', error);
    alert(`Error loading instruction file:\n${instructionFileName}`);
    return; // STOP everything
  }

  zip.folder('instructions')?.file(instructionFileName, instructionText);

  // 2. Generate Bundles
  const bundles = generateBundles(
    files,
    splitFiles,
    maxSizeMB,
    skipStats,
    config ?? undefined
  );

  const bundleFolder = zip.folder('bundles');

  bundles.forEach((content, index) => {
    const fileName =
      bundles.length > 1
        ? `${projectName}_Bundle_${String(index + 1).padStart(3, '0')}_of_${String(bundles.length).padStart(3, '0')}.md`
        : `${projectName}_Bundle.md`;

    bundleFolder?.file(fileName, content);
  });

  // 3. README
  zip.file('README.txt', generateReadme());

  // 4. Generate & Download ZIP
  try {
    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `${projectName}_${selectedTemplate.replace(/[^a-z0-9]+/gi, '_')}_WorkPackage.zip`;

    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    URL.revokeObjectURL(url);
  } catch (error) {
    console.error('Error generating ZIP:', error);
    alert('Failed to generate ZIP file.');
  }
};

  const handleDownloadBundleOnly = () => {
    if (files.length === 0) return;

    const bundles = generateBundles(
      files,
      splitFiles,
      maxSizeMB,
      skipStats,
      config ?? undefined
    );

    bundles.forEach((content, index) => {
      const fileName =
        bundles.length > 1
          ? `${projectName}_Bundle_${String(index + 1).padStart(3, '0')}_of_${String(bundles.length).padStart(3, '0')}.md`
          : `${projectName}_Bundle.md`;

      const blob = new Blob([content], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');

      a.href = url;
      a.download = fileName;

      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      URL.revokeObjectURL(url);
    });
  };

  const totalSize = files.reduce((acc, file) => acc + file.size, 0);
  const estimatedBundles = Math.ceil(totalSize / (maxSizeMB * 1024 * 1024)) || 1;

  return (
    <div className="app-container">
      <h1>Prompt Pipeline</h1>

      <div className="controls">
        <div className="filter-options">
          <label>
            <input
              type="checkbox"
              checked={includeJson}
              onChange={(e) => setIncludeJson(e.target.checked)}
            />
            Include .json files
          </label>

          <label>
            <input
              type="checkbox"
              checked={includeMd}
              onChange={(e) => setIncludeMd(e.target.checked)}
            />
            Include .md files
          </label>
        </div>

        <button
          className="main-btn"
          onClick={() => fileInputRef.current?.click()}
          disabled={isProcessing || config === null}
        >
          {isProcessing ? 'Processing...' : '1. Select Folder'}
        </button>

        <input
          type="file"
          ref={fileInputRef}
          style={{ display: 'none' }}
          {...({ webkitdirectory: '', directory: '' } as any)}
          onChange={handleFolderSelect}
        />

        {files.length > 0 && (
          <div className="bundle-options">
            <div className="template-select">
              <label htmlFor="template">2. Choose Template:</label>
              <select
                id="template"
                value={selectedTemplate}
                onChange={(e) => setSelectedTemplate(e.target.value as TemplateType)}
              >
                {Object.keys(TEMPLATE_MAPPING).map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </div>

            <button className="download-btn primary" onClick={handleDownloadWorkPackage}>
              3. Download Work Package (.zip)
            </button>

            <button className="download-btn secondary" onClick={handleDownloadBundleOnly}>
              Download Bundle Only
            </button>

            <div className="option-row">
              <label>
                <input
                  type="checkbox"
                  checked={splitFiles}
                  onChange={(e) => setSplitFiles(e.target.checked)}
                />
                Split into multiple .md files
              </label>
            </div>

            <div className="option-row">
              <label htmlFor="maxSize">Max bundle size (MB):</label>
              <input
                id="maxSize"
                type="number"
                value={maxSizeMB}
                step="0.1"
                min="0.1"
                onChange={(e) => {
                  const parsed = parseFloat(e.target.value);
                  setMaxSizeMB(Number.isFinite(parsed) && parsed > 0 ? parsed : 1.5);
                }}
              />
            </div>
          </div>
        )}
      </div>

      {files.length > 0 && (
        <div className="status">
          <div className="status-main">
            <p>
              <strong>Files included:</strong> {files.length}
            </p>
            <p>
              <strong>Files skipped:</strong> {skipStats.total}
            </p>
            <p>
              <strong>Estimated total size:</strong> {(totalSize / 1024 / 1024).toFixed(2)} MB
            </p>
            <p>
              <strong>Bundles to be generated:</strong> {splitFiles ? estimatedBundles : 1}
            </p>
          </div>

          <div className="skip-reasons">
            <h4>Skipped by type:</h4>
            <ul>
              {Object.entries(skipStats.byExtension)
                .sort((a, b) => b[1] - a[1])
                .map(([ext, count]) => (
                  <li key={ext}>
                    {count} {ext} files
                  </li>
                ))}
            </ul>

            <h4>Skipped by reason:</h4>
            <ul>
              {Object.entries(skipStats.byReason)
                .sort((a, b) => b[1] - a[1])
                .map(([reason, count]) => (
                  <li key={reason}>
                    {reason}: {count}
                  </li>
                ))}
            </ul>
          </div>
        </div>
      )}

      {files.length > 0 && (
        <div className="file-preview">
          <h3>Files Included:</h3>
          <ul>
            {files.map((file, idx) => (
              <li key={idx}>{file.path}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function sanitizeFileName(value: string): string {
  return value.replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '');
}

export default App;