import {
  DEFAULT_CONFIG,
  type PromptPipelineConfig
} from './constants';

export interface ProcessedFile {
  path: string;
  content: string;
  size: number;
}

export interface SkipStats {
  total: number;
  byReason: Record<string, number>;
  byExtension: Record<string, number>;
}

export interface ProcessingResult {
  processed: ProcessedFile[];
  skipStats: SkipStats;
}

export interface ProcessingProgress {
  totalFilesScanned: number;
  filesProcessed: number;
  filesSkipped: number;
}

export interface ProcessFilesOptions {
  includeJson: boolean;
  includeMd: boolean;
  config?: PromptPipelineConfig;
  maxIndividualFileSizeBytes?: number;
  batchSize?: number;
  onProgress?: (progress: ProcessingProgress) => void;
}

const DEFAULT_MAX_INDIVIDUAL_FILE_SIZE = 200 * 1024; // 200KB
const DEFAULT_BATCH_SIZE = 40;
const TEXT_ENCODER = new TextEncoder();
const BUILT_IN_BINARY_EXTENSIONS = new Set([
  '.7z',
  '.a',
  '.aac',
  '.accdb',
  '.ai',
  '.apk',
  '.avif',
  '.bin',
  '.class',
  '.db',
  '.dmg',
  '.doc',
  '.docx',
  '.eot',
  '.epub',
  '.flac',
  '.heic',
  '.heif',
  '.ico',
  '.icns',
  '.jar',
  '.m4a',
  '.mdb',
  '.mkv',
  '.mov',
  '.mp3',
  '.mp4',
  '.o',
  '.otf',
  '.pdf',
  '.pickle',
  '.pkl',
  '.png',
  '.ppt',
  '.pptx',
  '.psd',
  '.pyc',
  '.rar',
  '.sqlite',
  '.sqlite3',
  '.tar',
  '.ttf',
  '.war',
  '.wasm',
  '.wav',
  '.webm',
  '.woff',
  '.woff2',
  '.xls',
  '.xlsx',
  '.zip'
]);
const BUILT_IN_BINARY_MIME_PREFIXES = ['audio/', 'font/', 'image/', 'video/'];
const BUILT_IN_BINARY_MIME_TYPES = new Set([
  'application/gzip',
  'application/java-archive',
  'application/octet-stream',
  'application/pdf',
  'application/vnd.ms-access',
  'application/vnd.ms-excel',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/x-7z-compressed',
  'application/x-rar-compressed',
  'application/x-sqlite3',
  'application/zip'
]);

export async function processFiles(
  files: FileList,
  options: ProcessFilesOptions
): Promise<ProcessingResult> {
  const config = options.config ?? DEFAULT_CONFIG;
  const maxIndividualFileSize =
    options.maxIndividualFileSizeBytes ?? DEFAULT_MAX_INDIVIDUAL_FILE_SIZE;
  const batchSize = Math.max(1, options.batchSize ?? DEFAULT_BATCH_SIZE);

  const processedFiles: ProcessedFile[] = [];
  const skipStats: SkipStats = {
    total: 0,
    byReason: {},
    byExtension: {}
  };

  const incrementReason = (reason: string) => {
    skipStats.byReason[reason] = (skipStats.byReason[reason] || 0) + 1;
    skipStats.total++;
  };

  const incrementExtension = (ext: string) => {
    skipStats.byExtension[ext] = (skipStats.byExtension[ext] || 0) + 1;
  };

  const excludedFolders = new Set(config.excludedFolders.map(normalizeName));
  const excludedFiles = new Set(config.excludedFiles.map(normalizeName));
  const requiredExtensions = new Set(config.requiredExtensions.map(normalizeExtension));
  const optionalExtensions = new Set(config.optionalExtensions.map(normalizeExtension));
  const excludedExtensions = new Set(config.excludedExtensions.map(normalizeExtension));
  const progress: ProcessingProgress = {
    totalFilesScanned: 0,
    filesProcessed: 0,
    filesSkipped: 0
  };

  const emitProgress = () => {
    options.onProgress?.({ ...progress });
  };

  emitProgress();

  for (let batchStart = 0; batchStart < files.length; batchStart += batchSize) {
    const batchEnd = Math.min(batchStart + batchSize, files.length);

    for (let i = batchStart; i < batchEnd; i++) {
      const file = files[i];
      const path = (file as any).webkitRelativePath || file.name;
      const parts = path.split('/').filter(Boolean);
      const fileName = normalizeName(parts[parts.length - 1] || file.name);
      const extension = getExtension(path);

      progress.totalFilesScanned++;

      const markSkipped = (reason: string) => {
        incrementReason(reason);
        progress.filesSkipped++;
      };

      const hasExcludedFolder = parts.some((part: string) =>
        excludedFolders.has(normalizeName(part))
      );

      if (hasExcludedFolder) {
        markSkipped('Folder Excluded');
        continue;
      }

      if (excludedFiles.has(fileName)) {
        markSkipped('File Excluded');
        incrementExtension(extension);
        continue;
      }

      if (excludedExtensions.has(extension)) {
        markSkipped('Extension Excluded');
        incrementExtension(extension);
        continue;
      }

      if (shouldSkipAsBinaryOrMedia(file, extension)) {
        markSkipped('Binary or Media File');
        incrementExtension(extension);
        continue;
      }

      const isRequired = requiredExtensions.has(extension);
      const isOptional =
        optionalExtensions.has(extension) &&
        ((extension === '.json' && options.includeJson) ||
          (extension === '.md' && options.includeMd) ||
          (extension !== '.json' && extension !== '.md'));

      if (!isRequired && !isOptional) {
        markSkipped('Not Useful for Analysis');
        incrementExtension(extension);
        continue;
      }

      if (file.size > maxIndividualFileSize) {
        markSkipped('File Too Large');
        incrementExtension(extension);
        continue;
      }

      try {
        const content = await readFileContent(file);
        const redactedContent = redactSecrets(content, config);

        processedFiles.push({
          path,
          content: redactedContent,
          size: getUtf8Size(redactedContent)
        });
        progress.filesProcessed++;
      } catch (error) {
        console.error(`[PromptPipeline] Failed to read file: ${path}`, error);
        markSkipped('Read Error');
        incrementExtension(extension);
      }
    }

    emitProgress();
    await yieldToBrowser();
  }

  emitProgress();
  return { processed: processedFiles, skipStats };
}

async function readFileContent(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

function redactSecrets(content: string, config: PromptPipelineConfig): string {
  let redacted = content;

  config.secretKeywords.forEach((keyword) => {
    const escapedKeyword = escapeRegExp(keyword);

    const regex = new RegExp(
      `(\\b${escapedKeyword}\\b\\s*[:=]?\\s*)(['"]?)([^'"\\s;\\n,]+)(['"]?)`,
      'gi'
    );

    redacted = redacted.replace(regex, '$1$2REDACTED$4');
  });

  return redacted;
}

export function generateBundles(
  files: ProcessedFile[],
  splitFiles: boolean,
  maxSizeMB: number,
  skipStats: SkipStats,
  config: PromptPipelineConfig = DEFAULT_CONFIG
): string[] {
  const bundles: string[] = [];
  buildBundles(files, splitFiles, maxSizeMB, skipStats, config, (bundle) => {
    bundles.push(bundle);
  });
  return bundles;
}

export function forEachGeneratedBundle(
  files: ProcessedFile[],
  splitFiles: boolean,
  maxSizeMB: number,
  skipStats: SkipStats,
  config: PromptPipelineConfig = DEFAULT_CONFIG,
  callback: (content: string, index: number, totalBundles: number) => void
): void {
  let bundleIndex = 0;

  buildBundles(files, splitFiles, maxSizeMB, skipStats, config, (bundle, totalBundles) => {
    callback(bundle, bundleIndex, totalBundles);
    bundleIndex++;
  });
}

function buildBundles(
  files: ProcessedFile[],
  splitFiles: boolean,
  maxSizeMB: number,
  skipStats: SkipStats,
  config: PromptPipelineConfig,
  onBundle: (content: string, totalBundles: number) => void
): void {
  const maxSizeBytes = maxSizeMB * 1024 * 1024;
  const totalSizeMB = (files.reduce((acc, f) => acc + f.size, 0) / 1024 / 1024).toFixed(2);

  const getHeader = (bundleIdx: number, totalBundles: number) => {
    let header = `# PromptPipeline Code Bundle\n\n`;
    header += `## Bundle Context\n\n`;
    header += `This bundle contains source code files relevant for analysis.\n\n`;
    header += `## Bundle Summary\n\n`;
    header += `- Files included: ${files.length}\n`;
    header += `- Files skipped: ${skipStats.total}\n`;
    header += `- Estimated size: ${totalSizeMB} MB\n`;

    if (totalBundles > 1) {
      header += `- Bundle part: ${bundleIdx + 1}/${totalBundles}\n`;
    }

    header += `\n---\n\n## Files\n\n`;
    return header;
  };

  if (!splitFiles) {
    let bundleContent = getHeader(0, 1);

    for (const file of files) {
      bundleContent += renderFileSection(file, config);
    }

    onBundle(bundleContent, 1);
    return;
  }

  const bundlePlans = planBundles(files, maxSizeBytes, config);
  const totalBundles = bundlePlans.length || 1;

  for (let bundleIdx = 0; bundleIdx < bundlePlans.length; bundleIdx++) {
    const plan = bundlePlans[bundleIdx];
    let bundleContent = getHeader(bundleIdx, totalBundles);

    for (const fileIndex of plan.fileIndexes) {
      bundleContent += renderFileSection(files[fileIndex], config);
    }

    onBundle(bundleContent, totalBundles);
  }
}

function getExtension(path: string): string {
  const normalizedPath = path.toLowerCase();
  const lastSlash = normalizedPath.lastIndexOf('/');
  const fileName = lastSlash !== -1 ? normalizedPath.substring(lastSlash + 1) : normalizedPath;
  const lastDot = fileName.lastIndexOf('.');

  return lastDot !== -1 ? fileName.substring(lastDot) : 'no-extension';
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeExtension(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized === 'no-extension') return 'no-extension';
  return normalized.startsWith('.') ? normalized : `.${normalized}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function shouldSkipAsBinaryOrMedia(file: File, extension: string): boolean {
  if (BUILT_IN_BINARY_EXTENSIONS.has(extension)) {
    return true;
  }

  const mimeType = file.type.toLowerCase();
  if (!mimeType) {
    return false;
  }

  if (BUILT_IN_BINARY_MIME_TYPES.has(mimeType)) {
    return true;
  }

  return BUILT_IN_BINARY_MIME_PREFIXES.some((prefix) => mimeType.startsWith(prefix));
}

function getUtf8Size(content: string): number {
  return TEXT_ENCODER.encode(content).length;
}

function renderFileSection(file: ProcessedFile, config: PromptPipelineConfig): string {
  const ext = getExtension(file.path);
  const lang = config.extensionToLang[ext] || 'text';
  return `## FILE: ${file.path}\n\n\`\`\`${lang}\n${file.content}\n\`\`\`\n\n`;
}

function planBundles(
  files: ProcessedFile[],
  maxSizeBytes: number,
  config: PromptPipelineConfig
): Array<{ fileIndexes: number[] }> {
  if (files.length === 0) {
    return [];
  }

  const plannedBundles: Array<{ fileIndexes: number[] }> = [];
  let currentBundle: number[] = [];
  const headerOverhead = getUtf8Size(getBundleHeaderTemplate(files.length));
  let currentBundleSize = headerOverhead;

  files.forEach((file, index) => {
    const sectionSize = getUtf8Size(renderFileSection(file, config));

    if (currentBundle.length > 0 && currentBundleSize + sectionSize > maxSizeBytes) {
      plannedBundles.push({ fileIndexes: currentBundle });
      currentBundle = [];
      currentBundleSize = headerOverhead;
    }

    currentBundle.push(index);
    currentBundleSize += sectionSize;
  });

  if (currentBundle.length > 0) {
    plannedBundles.push({ fileIndexes: currentBundle });
  }

  return plannedBundles;
}

async function yieldToBrowser(): Promise<void> {
  await new Promise<void>((resolve) => {
    window.setTimeout(resolve, 0);
  });
}

function getBundleHeaderTemplate(fileCount: number): string {
  return `# PromptPipeline Code Bundle

## Bundle Context

This bundle contains source code files relevant for analysis.

## Bundle Summary

- Files included: ${fileCount}
- Files skipped: 999999
- Estimated size: 9999.99 MB
- Bundle part: 999/999

---

## Files

`;
}
