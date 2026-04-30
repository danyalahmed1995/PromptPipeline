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

export interface ProcessFilesOptions {
  includeJson: boolean;
  includeMd: boolean;
  config?: PromptPipelineConfig;
  maxIndividualFileSizeBytes?: number;
}

const DEFAULT_MAX_INDIVIDUAL_FILE_SIZE = 200 * 1024; // 200KB

export async function processFiles(
  files: FileList,
  options: ProcessFilesOptions
): Promise<ProcessingResult> {
  const config = options.config ?? DEFAULT_CONFIG;
  const maxIndividualFileSize =
    options.maxIndividualFileSizeBytes ?? DEFAULT_MAX_INDIVIDUAL_FILE_SIZE;

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

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const path = (file as any).webkitRelativePath || file.name;
    const parts = path.split('/').filter(Boolean);
    const fileName = normalizeName(parts[parts.length - 1] || file.name);
    const extension = getExtension(path);

    // 1. Folder exclusion
    const hasExcludedFolder = parts.some((part: string) =>
      excludedFolders.has(normalizeName(part))
    );

    if (hasExcludedFolder) {
      incrementReason('Folder Excluded');
      continue;
    }

    // 2. Explicit file exclusion
    if (excludedFiles.has(fileName)) {
      incrementReason('File Excluded');
      incrementExtension(extension);
      continue;
    }

    // 3. Extension exclusion
    if (excludedExtensions.has(extension)) {
      incrementReason('Extension Excluded');
      incrementExtension(extension);
      continue;
    }

    // 4. Extension inclusion
    const isRequired = requiredExtensions.has(extension);

    const isOptional =
      optionalExtensions.has(extension) &&
      ((extension === '.json' && options.includeJson) ||
        (extension === '.md' && options.includeMd) ||
        (extension !== '.json' && extension !== '.md'));

    if (!isRequired && !isOptional) {
      incrementReason('Not Useful for Analysis');
      incrementExtension(extension);
      continue;
    }

    // 5. Size limit
    if (file.size > maxIndividualFileSize) {
      incrementReason('File Too Large');
      incrementExtension(extension);
      continue;
    }

    try {
      const content = await readFileContent(file);
      const redactedContent = redactSecrets(content, config);

      processedFiles.push({
        path,
        content: redactedContent,
        size: new Blob([redactedContent]).size
      });
    } catch (error) {
      console.error(`[PromptPipeline] Failed to read file: ${path}`, error);
      incrementReason('Read Error');
      incrementExtension(extension);
    }
  }

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

  const fileContents = files.map((file) => {
    const ext = getExtension(file.path);
    const lang = config.extensionToLang[ext] || 'text';

    return `## FILE: ${file.path}\n\n\`\`\`${lang}\n${file.content}\n\`\`\`\n\n`;
  });

  if (!splitFiles) {
    bundles.push(getHeader(0, 1) + fileContents.join(''));
    return bundles;
  }

  let currentBundleContent = '';
  let bundleIdx = 0;
  const estimatedTotal = Math.ceil(parseFloat(totalSizeMB) / maxSizeMB) || 1;

  fileContents.forEach((content) => {
    const contentSize = new Blob([content]).size;

    if (
      currentBundleContent !== '' &&
      new Blob([currentBundleContent]).size + contentSize > maxSizeBytes
    ) {
      bundles.push(currentBundleContent);
      currentBundleContent = '';
      bundleIdx++;
    }

    if (currentBundleContent === '') {
      currentBundleContent = getHeader(bundleIdx, estimatedTotal);
    }

    currentBundleContent += content;
  });

  if (currentBundleContent !== '') {
    bundles.push(currentBundleContent);
  }

  return bundles;
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