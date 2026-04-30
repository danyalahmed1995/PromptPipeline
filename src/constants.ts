export type PromptPipelineConfig = {
  excludedFolders: string[];
  excludedFiles: string[];
  requiredExtensions: string[];
  optionalExtensions: string[];
  excludedExtensions: string[];
  secretKeywords: string[];
  extensionToLang: Record<string, string>;
};

export const DEFAULT_CONFIG: PromptPipelineConfig = {
  excludedFolders: [
    'node_modules', '.git', 'Library', 'Temp', 'obj', 'bin',
    'Build', 'Builds', 'Logs', 'dist', '.next', '.vscode'
  ],
  excludedFiles: [
    'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml'
  ],
  requiredExtensions: ['.cs', '.ts', '.js', '.jsx', '.tsx'],
  optionalExtensions: ['.json', '.md'],
  excludedExtensions: ['.meta', '.xml', '.txt', '.log'],
  secretKeywords: [
    'apiKey', 'token', 'secret', 'private_key', 'client_secret',
    'bearer', 'firebase', 'stripe', 'jwt'
  ],
  extensionToLang: {
    '.ts': 'ts',
    '.tsx': 'tsx',
    '.js': 'js',
    '.jsx': 'jsx',
    '.cs': 'csharp',
    '.json': 'json',
    '.md': 'markdown',
    '.html': 'html',
    '.css': 'css',
    '.xml': 'xml',
    '.yml': 'yaml',
    '.yaml': 'yaml',
    '.txt': 'text'
  }
};

export async function loadPromptPipelineConfig(): Promise<PromptPipelineConfig> {
  try {
    const response = await fetch('/config/default-config.json');

    if (!response.ok) {
      console.warn('[PromptPipeline] default-config.json not found. Using fallback config.');
      return DEFAULT_CONFIG;
    }

    const loadedConfig = await response.json();

    return {
      ...DEFAULT_CONFIG,
      ...loadedConfig,
      extensionToLang: {
        ...DEFAULT_CONFIG.extensionToLang,
        ...(loadedConfig.extensionToLang ?? {})
      }
    };
  } catch (error) {
    console.warn('[PromptPipeline] Failed to load default-config.json. Using fallback config.', error);
    return DEFAULT_CONFIG;
  }
}

// Backward-compatible exports.
// These let existing imports keep working while the app migrates to runtime config.
export const EXCLUDED_FOLDERS = DEFAULT_CONFIG.excludedFolders;
export const EXCLUDED_FILES = DEFAULT_CONFIG.excludedFiles;
export const REQUIRED_EXTENSIONS = DEFAULT_CONFIG.requiredExtensions;
export const OPTIONAL_EXTENSIONS = DEFAULT_CONFIG.optionalExtensions;
export const EXCLUDED_EXTENSIONS = DEFAULT_CONFIG.excludedExtensions;
export const SECRET_KEYWORDS = DEFAULT_CONFIG.secretKeywords;
export const EXTENSION_TO_LANG = DEFAULT_CONFIG.extensionToLang;

export const CHUNK_SIZE = 12000;

export const TEMPLATE_MAPPING = {
  'Bug Report': 'bug_report_instructions.txt',
  'Apply Fixes': 'codex_fix_instructions.txt',
  'Refactor Plan': 'refactor_plan_instructions.txt',
  'Unit Tests': 'unit_test_instructions.txt'
};

export type TemplateType = keyof typeof TEMPLATE_MAPPING;