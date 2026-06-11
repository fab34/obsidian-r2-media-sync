import {
  App,
  Notice,
  Plugin,
  PluginSettingTab,
  requestUrl,
  Setting,
  TFile,
  TFolder,
  normalizePath,
} from "obsidian";
import * as crypto from "crypto";

type ConfigSource = "manual" | "ezimage";
type ScanScopeMode = "vault" | "folders";
type UiLanguage = "auto" | "en" | "zh-TW";

interface R2MediaSyncSettings {
  uiLanguage: UiLanguage;
  configSource: ConfigSource;
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
  publicUrl: string;
  pathTemplate: string;
  deleteLocalAfterUpload: boolean;
  reuseUploadedByHash: boolean;
  processMarkdownImages: boolean;
  processWikiImages: boolean;
  processOnStartup: boolean;
  scanScopeMode: ScanScopeMode;
  includeFolders: string[];
  excludeFolders: string[];
  debounceMs: number;
  maxUploadAttempts: number;
}

interface EzImageR2Settings {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
  publicUrl: string;
}

interface EzImageSettingsFile {
  r2: EzImageR2Settings;
  pathTemplate?: string;
}

const DEFAULT_SETTINGS: R2MediaSyncSettings = {
  uiLanguage: "auto",
  configSource: "ezimage",
  accountId: "",
  accessKeyId: "",
  secretAccessKey: "",
  bucketName: "",
  publicUrl: "",
  pathTemplate: "{yyyy}/{MM}/{timestamp}-{random}.{ext}",
  deleteLocalAfterUpload: false,
  reuseUploadedByHash: true,
  processMarkdownImages: true,
  processWikiImages: true,
  processOnStartup: false,
  scanScopeMode: "vault",
  includeFolders: ["AI 工作區"],
  excludeFolders: [".obsidian", ".git", ".trash", "Templates"],
  debounceMs: 4000,
  maxUploadAttempts: 3,
};

const SETTING_KEYS = new Set<keyof R2MediaSyncSettings>([
  "uiLanguage",
  "configSource",
  "accountId",
  "accessKeyId",
  "secretAccessKey",
  "bucketName",
  "publicUrl",
  "pathTemplate",
  "deleteLocalAfterUpload",
  "reuseUploadedByHash",
  "processMarkdownImages",
  "processWikiImages",
  "processOnStartup",
  "scanScopeMode",
  "includeFolders",
  "excludeFolders",
  "debounceMs",
  "maxUploadAttempts",
]);

const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"]);
const MARKDOWN_IMAGE_RE = /!\[([^\]]*)\]\(([^)]+)\)/g;
const WIKILINK_IMAGE_RE = /!\[\[([^\]]+\.(?:png|jpe?g|gif|webp|bmp|svg))(?:\|[^\]]*)?\]\]/gi;
const FAILED_UPLOAD_LOG = "failed_uploads.json";
const UPLOAD_HISTORY_LOG = "upload_history.json";
const MAX_FAILED_UPLOADS = 100;

const TEXT = {
  en: {
    idle: "Idle",
    noActiveNote: "No active note.",
    scannedNotice: "Scanned {scanned} Markdown file(s), uploaded {uploaded} image(s).",
    noFailedUploads: "No failed uploads recorded.",
    failedUploadSummary: "{count} failed upload(s). Latest: {path}",
    failedUploadLogCleared: "Failed upload log cleared.",
    scanning: "Scanning {count} Markdown file(s)...",
    scannedStatus: "Scanned {scanned} Markdown file(s), uploaded {uploaded} image(s).",
    noLocalImagesFound: "No local images found.",
    processing: "Processing {path}",
    noLocalImagesIn: "No local images found in {path}",
    reusedUrl: "Reused existing R2 URL for {path}",
    retrying: "Retrying {path} ({attempt}/{attempts})",
    recordedFailedUpload: "Recorded failed upload: {path}",
    uploadedFor: "Uploaded {count} image(s) for {path}",
    uploadedNotice: "Uploaded {count} image(s).",
    deleteEnabledNotice: "Local files will be moved to trash after successful upload and link rewrite.",
    importedEzImage: "Imported EzImage R2 settings.",
    importEzImageFailed: "Could not import EzImage settings",
    startupScanFailed: "Startup scan failed",
    syncFailed: "R2 Media Sync failed",
    cmdProcessCurrent: "Upload local images in current note",
    cmdScanScope: "Scan configured scope now",
    cmdImportEzImage: "Import settings from EzImage",
    cmdShowFailed: "Show failed upload summary",
    cmdClearFailed: "Clear failed upload log",
    languageName: "Language",
    languageDesc: "Choose the plugin interface language.",
    languageAuto: "Auto",
    languageEnglish: "English",
    languageTraditionalChinese: "Traditional Chinese",
    r2SourceName: "R2 settings source",
    r2SourceDesc: "Use EzImage settings when available, or store R2 credentials in this plugin.",
    readFromEzImage: "Read from EzImage",
    manual: "Manual",
    importFromEzImageName: "Import from EzImage",
    importFromEzImageDesc: "Copy EzImage's R2 settings into this plugin, then switch to Manual.",
    importButton: "Import",
    accountIdName: "Cloudflare account ID",
    accountIdDesc: "R2 account ID.",
    accessKeyIdName: "Access key ID",
    accessKeyIdDesc: "R2 access key ID.",
    secretAccessKeyName: "Secret access key",
    secretAccessKeyDesc: "R2 secret access key.",
    bucketNameName: "Bucket name",
    bucketNameDesc: "Target R2 bucket.",
    publicUrlName: "Public URL",
    publicUrlDesc: "Public bucket URL or custom domain, without trailing slash.",
    pathTemplateName: "Path template",
    pathTemplateDesc: "Supported tokens: {yyyy}, {MM}, {dd}, {hh}, {mm}, {ss}, {timestamp}, {random}, {name}, {ext}.",
    deleteLocalName: "Delete local image after upload",
    deleteLocalDesc: "Off by default. Enable only if you are comfortable removing local files after successful upload.",
    reuseHashName: "Reuse uploads by file hash",
    reuseHashDesc: "Avoid uploading the same image content more than once. The plugin stores a local hash-to-URL history.",
    processMarkdownName: "Process Markdown image links",
    processMarkdownDesc: "Process links like ![](image.png).",
    processWikiName: "Process wiki image embeds",
    processWikiDesc: "Process links like ![[image.png]].",
    scanStartupName: "Scan on startup",
    scanStartupDesc: "Off by default. Enable after testing your R2 settings and scan scope.",
    scanScopeName: "Scan scope",
    scanScopeDesc: "Scan the whole vault, or only specific top-level/project folders.",
    wholeVault: "Whole vault",
    includedFoldersOnly: "Only included folders",
    includedFoldersName: "Included folders",
    includedFoldersDesc: "Comma-separated vault-relative folders.",
    excludedFoldersName: "Excluded folders",
    excludedFoldersDesc: "Comma-separated vault-relative folders. Defaults protect .obsidian, .git, trash, and Templates.",
    debounceName: "Debounce delay",
    debounceDesc: "Milliseconds to wait after file changes before processing.",
    retryAttemptsName: "Upload retry attempts",
    retryAttemptsDesc: "Number of times to try each R2 upload before recording it as failed.",
    scanNowName: "Scan now",
    scanNowDesc: "Scan the configured scope immediately.",
    scanButton: "Scan",
    noRecentActivity: "No recent activity.",
  },
  "zh-TW": {
    idle: "閒置中",
    noActiveNote: "目前沒有開啟中的筆記。",
    scannedNotice: "已掃描 {scanned} 篇 Markdown，已上傳 {uploaded} 張圖片。",
    noFailedUploads: "目前沒有失敗上傳紀錄。",
    failedUploadSummary: "共有 {count} 筆失敗上傳。最新一筆：{path}",
    failedUploadLogCleared: "已清除失敗上傳紀錄。",
    scanning: "正在掃描 {count} 篇 Markdown...",
    scannedStatus: "已掃描 {scanned} 篇 Markdown，已上傳 {uploaded} 張圖片。",
    noLocalImagesFound: "沒有找到本機圖片。",
    processing: "正在處理 {path}",
    noLocalImagesIn: "{path} 沒有找到本機圖片",
    reusedUrl: "已重用既有 R2 URL：{path}",
    retrying: "正在重試 {path}（{attempt}/{attempts}）",
    recordedFailedUpload: "已記錄失敗上傳：{path}",
    uploadedFor: "{path} 已上傳 {count} 張圖片",
    uploadedNotice: "已上傳 {count} 張圖片。",
    deleteEnabledNotice: "成功上傳並改寫連結後，本機檔案會移到 Obsidian 的垃圾桶。",
    importedEzImage: "已匯入 EzImage 的 R2 設定。",
    importEzImageFailed: "無法匯入 EzImage 設定",
    startupScanFailed: "啟動掃描失敗",
    syncFailed: "R2 Media Sync 執行失敗",
    cmdProcessCurrent: "上傳目前筆記中的本機圖片",
    cmdScanScope: "立即掃描設定範圍",
    cmdImportEzImage: "從 EzImage 匯入設定",
    cmdShowFailed: "顯示失敗上傳摘要",
    cmdClearFailed: "清除失敗上傳紀錄",
    languageName: "語言",
    languageDesc: "選擇插件介面語言。",
    languageAuto: "自動",
    languageEnglish: "English",
    languageTraditionalChinese: "繁體中文",
    r2SourceName: "R2 設定來源",
    r2SourceDesc: "可讀取 EzImage 設定，或將 R2 憑證儲存在本插件中。",
    readFromEzImage: "從 EzImage 讀取",
    manual: "手動設定",
    importFromEzImageName: "從 EzImage 匯入",
    importFromEzImageDesc: "將 EzImage 的 R2 設定複製到本插件，並切換為手動設定。",
    importButton: "匯入",
    accountIdName: "Cloudflare account ID",
    accountIdDesc: "R2 account ID。",
    accessKeyIdName: "Access key ID",
    accessKeyIdDesc: "R2 access key ID。",
    secretAccessKeyName: "Secret access key",
    secretAccessKeyDesc: "R2 secret access key。",
    bucketNameName: "Bucket name",
    bucketNameDesc: "目標 R2 bucket。",
    publicUrlName: "Public URL",
    publicUrlDesc: "公開 bucket URL 或自訂網域，不要包含結尾斜線。",
    pathTemplateName: "路徑樣板",
    pathTemplateDesc: "支援 token：{yyyy}, {MM}, {dd}, {hh}, {mm}, {ss}, {timestamp}, {random}, {name}, {ext}。",
    deleteLocalName: "上傳後刪除本機圖片",
    deleteLocalDesc: "預設關閉。確認你能接受成功上傳後移除本機檔案，再啟用此選項。",
    reuseHashName: "依檔案雜湊重用上傳結果",
    reuseHashDesc: "避免相同圖片內容重複上傳。插件會在本機保存雜湊與 URL 對應紀錄。",
    processMarkdownName: "處理 Markdown 圖片連結",
    processMarkdownDesc: "處理 ![](image.png) 這類連結。",
    processWikiName: "處理 Wiki 圖片嵌入",
    processWikiDesc: "處理 ![[image.png]] 這類連結。",
    scanStartupName: "啟動時掃描",
    scanStartupDesc: "預設關閉。請先測試 R2 設定與掃描範圍後再啟用。",
    scanScopeName: "掃描範圍",
    scanScopeDesc: "掃描整個 vault，或只掃描指定的資料夾。",
    wholeVault: "整個 vault",
    includedFoldersOnly: "只掃描指定資料夾",
    includedFoldersName: "指定資料夾",
    includedFoldersDesc: "以逗號分隔的 vault 相對資料夾路徑。",
    excludedFoldersName: "排除資料夾",
    excludedFoldersDesc: "以逗號分隔的 vault 相對資料夾路徑。預設會保護 .obsidian、.git、trash 與 Templates。",
    debounceName: "延遲處理時間",
    debounceDesc: "檔案變更後等待多少毫秒再開始處理。",
    retryAttemptsName: "上傳重試次數",
    retryAttemptsDesc: "每張圖片上傳失敗後，最多嘗試幾次才記錄為失敗。",
    scanNowName: "立即掃描",
    scanNowDesc: "立即掃描目前設定的範圍。",
    scanButton: "掃描",
    noRecentActivity: "尚無近期活動。",
  },
} as const;

type TextKey = keyof typeof TEXT.en;

function formatText(template: string, values?: Record<string, string | number>): string {
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (match, key) => String(values[key] ?? match));
}

function preferredLanguage(setting: UiLanguage): "en" | "zh-TW" {
  if (setting === "en" || setting === "zh-TW") return setting;
  const language = navigator.language.toLowerCase();
  return language.includes("zh-tw") || language.includes("zh-hant") || language.includes("zh-hk") || language.includes("zh-mo")
    ? "zh-TW"
    : "en";
}

function hmac(key: crypto.BinaryLike, value: string): Buffer {
  return crypto.createHmac("sha256", key).update(value, "utf8").digest();
}

function sha256Hex(value: crypto.BinaryLike): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function encodeKey(value: string): string {
  return value.split("/").map((part) => encodeURIComponent(part)).join("/");
}

function randomSuffix(length = 8): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < length; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

function mimeType(fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase();
  return {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    bmp: "image/bmp",
    svg: "image/svg+xml",
  }[ext ?? ""] ?? "application/octet-stream";
}

function splitList(value: string): string[] {
  return value
    .split(",")
    .map((item) => normalizePath(item.trim()))
    .filter(Boolean);
}

function joinList(value: string[]): string {
  return value.join(", ");
}

function isRemote(target: string): boolean {
  return /^(https?:|data:)/i.test(target);
}

function stripAngleBrackets(value: string): string {
  return value.startsWith("<") && value.endsWith(">") ? value.slice(1, -1) : value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringProp(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function parseEzImageSettings(raw: string): EzImageSettingsFile {
  const data: unknown = JSON.parse(raw);
  if (!isRecord(data) || !isRecord(data.r2)) {
    throw new Error("EzImage settings file is missing R2 configuration.");
  }

  const accountId = stringProp(data.r2, "accountId");
  const accessKeyId = stringProp(data.r2, "accessKeyId");
  const secretAccessKey = stringProp(data.r2, "secretAccessKey");
  const bucketName = stringProp(data.r2, "bucketName");
  const publicUrl = stringProp(data.r2, "publicUrl");
  const pathTemplate = stringProp(data, "pathTemplate") ?? undefined;

  const missing = [
    ["accountId", accountId],
    ["accessKeyId", accessKeyId],
    ["secretAccessKey", secretAccessKey],
    ["bucketName", bucketName],
    ["publicUrl", publicUrl],
  ].filter(([, value]) => value === null);

  if (missing.length) {
    throw new Error(`EzImage R2 setting missing: ${missing.map(([key]) => key).join(", ")}`);
  }

  return {
    r2: {
      accountId: accountId!,
      accessKeyId: accessKeyId!,
      secretAccessKey: secretAccessKey!,
      bucketName: bucketName!,
      publicUrl: publicUrl!,
    },
    pathTemplate,
  };
}

function parseStoredSettings(value: unknown): Partial<R2MediaSyncSettings> {
  if (!isRecord(value)) return {};
  const parsed: Partial<R2MediaSyncSettings> = {};

  for (const [key, raw] of Object.entries(value)) {
    if (!SETTING_KEYS.has(key as keyof R2MediaSyncSettings)) continue;

    switch (key) {
      case "uiLanguage":
        if (raw === "auto" || raw === "en" || raw === "zh-TW") parsed.uiLanguage = raw;
        break;
      case "configSource":
        if (raw === "manual" || raw === "ezimage") parsed.configSource = raw;
        break;
      case "scanScopeMode":
        if (raw === "vault" || raw === "folders") parsed.scanScopeMode = raw;
        break;
      case "includeFolders":
      case "excludeFolders":
        if (Array.isArray(raw) && raw.every((item) => typeof item === "string")) {
          parsed[key] = raw;
        }
        break;
      case "deleteLocalAfterUpload":
      case "reuseUploadedByHash":
      case "processMarkdownImages":
      case "processWikiImages":
      case "processOnStartup":
        if (typeof raw === "boolean") parsed[key] = raw;
        break;
      case "debounceMs":
        if (typeof raw === "number" && Number.isFinite(raw)) parsed.debounceMs = raw;
        break;
      case "maxUploadAttempts":
        if (typeof raw === "number" && Number.isFinite(raw)) parsed.maxUploadAttempts = Math.max(1, Math.floor(raw));
        break;
      default:
        if (typeof raw === "string") parsed[key as keyof Pick<R2MediaSyncSettings, "accountId" | "accessKeyId" | "secretAccessKey" | "bucketName" | "publicUrl" | "pathTemplate">] = raw;
        break;
    }
  }

  return parsed;
}

function objectKeyFor(fileName: string, template: string): string {
  const now = new Date();
  const ext = fileName.includes(".") ? fileName.split(".").pop()!.toLowerCase() : "bin";
  const stem = fileName.replace(/\.[^.]+$/, "");
  const values: Record<string, string> = {
    "{timestamp}": String(Date.now()),
    "{yyyy}": String(now.getFullYear()),
    "{MM}": String(now.getMonth() + 1).padStart(2, "0"),
    "{dd}": String(now.getDate()).padStart(2, "0"),
    "{hh}": String(now.getHours()).padStart(2, "0"),
    "{mm}": String(now.getMinutes()).padStart(2, "0"),
    "{ss}": String(now.getSeconds()).padStart(2, "0"),
    "{random}": randomSuffix(),
    "{name}": stem,
    "{ext}": ext,
  };
  let key = template || DEFAULT_SETTINGS.pathTemplate;
  for (const [token, value] of Object.entries(values)) {
    key = key.split(token).join(value);
  }
  return key.replace(/^\/+/, "");
}

function signingKey(secret: string, dateStamp: string, region: string, service: string): Buffer {
  const dateKey = hmac(Buffer.from(`AWS4${secret}`, "utf8"), dateStamp);
  const regionKey = hmac(dateKey, region);
  const serviceKey = hmac(regionKey, service);
  return hmac(serviceKey, "aws4_request");
}

interface Replacement {
  start: number;
  end: number;
  text: string;
  image: TFile;
}

interface UploadHistoryEntry {
  fileName: string;
  key: string;
  size: number;
  uploadedAt: string;
  url: string;
}

interface FailedUploadEntry {
  time: string;
  markdownPath: string;
  imagePath: string;
  message: string;
  attempts: number;
}

export default class R2MediaSyncPlugin extends Plugin {
  settings: R2MediaSyncSettings;
  private queue = new Map<string, number>();
  private processing = new Set<string>();
  private lastStatus = "";
  private statusBarEl: HTMLElement | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.statusBarEl = this.addStatusBarItem();
    this.updateStatus(this.t("idle"));

    this.addSettingTab(new R2MediaSyncSettingTab(this.app, this));

    this.addCommand({
      id: "process-current-note",
      name: this.t("cmdProcessCurrent"),
      callback: async () => {
        const file = this.app.workspace.getActiveFile();
        if (file) {
          await this.processFile(file, true);
        } else {
          new Notice(`R2 Media Sync: ${this.t("noActiveNote")}`);
        }
      },
    });

    this.addCommand({
      id: "scan-configured-scope",
      name: this.t("cmdScanScope"),
      callback: async () => {
        const result = await this.scanConfiguredScope(true);
        new Notice(`R2 Media Sync: ${this.t("scannedNotice", { scanned: result.scanned, uploaded: result.uploaded })}`);
      },
    });

    this.addCommand({
      id: "import-ezimage-settings",
      name: this.t("cmdImportEzImage"),
      callback: async () => {
        await this.importEzImageSettings(true);
      },
    });

    this.addCommand({
      id: "show-failed-uploads",
      name: this.t("cmdShowFailed"),
      callback: async () => {
        const failed = await this.readFailedUploads();
        if (!failed.length) {
          new Notice(`R2 Media Sync: ${this.t("noFailedUploads")}`);
          return;
        }
        const latest = failed[failed.length - 1];
        new Notice(`R2 Media Sync: ${this.t("failedUploadSummary", { count: failed.length, path: latest.imagePath })}`);
      },
    });

    this.addCommand({
      id: "clear-failed-uploads",
      name: this.t("cmdClearFailed"),
      callback: async () => {
        await this.writeJsonFile(FAILED_UPLOAD_LOG, []);
        this.updateStatus(this.t("failedUploadLogCleared"));
        new Notice(`R2 Media Sync: ${this.t("failedUploadLogCleared")}`);
      },
    });

    this.registerEvent(this.app.vault.on("create", (file) => this.handleVaultEvent(file)));
    this.registerEvent(this.app.vault.on("modify", (file) => this.handleVaultEvent(file)));

    this.app.workspace.onLayoutReady(() => {
      if (this.settings.processOnStartup) {
        this.scanConfiguredScope(false).catch((error) => this.reportError(this.t("startupScanFailed"), error));
      }
    });
  }

  onunload(): void {
    for (const timeoutId of this.queue.values()) {
      window.clearTimeout(timeoutId);
    }
    this.queue.clear();
  }

  async loadSettings(): Promise<void> {
    const stored: unknown = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, parseStoredSettings(stored));
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  getLastStatus(): string {
    return this.lastStatus;
  }

  t(key: TextKey, values?: Record<string, string | number>): string {
    const language = preferredLanguage(this.settings.uiLanguage);
    return formatText(TEXT[language][key] ?? TEXT.en[key], values);
  }

  private updateStatus(message: string): void {
    this.lastStatus = message;
    if (this.statusBarEl) {
      this.statusBarEl.setText(`R2 Media Sync: ${message}`);
      this.statusBarEl.title = message;
    }
  }

  private handleVaultEvent(file: unknown): void {
    if (!(file instanceof TFile)) return;
    if (!this.isPathInScope(file.path)) return;

    if (file.extension === "md") {
      this.enqueue(file.path, this.settings.debounceMs);
      return;
    }

    if (IMAGE_EXTS.has(file.extension.toLowerCase())) {
      const parent = file.parent;
      if (!(parent instanceof TFolder)) return;
      for (const child of parent.children) {
        if (child instanceof TFile && child.extension === "md" && this.isPathInScope(child.path)) {
          this.enqueue(child.path, this.settings.debounceMs);
        }
      }
    }
  }

  private enqueue(path: string, delayMs: number): void {
    const previous = this.queue.get(path);
    if (previous) window.clearTimeout(previous);
    const timeoutId = window.setTimeout(() => {
      void (async () => {
        this.queue.delete(path);
        const file = this.app.vault.getAbstractFileByPath(path);
        if (file instanceof TFile) await this.processFile(file, false);
      })();
    }, Math.max(500, delayMs));
    this.queue.set(path, timeoutId);
  }

  async scanConfiguredScope(manual: boolean): Promise<{ scanned: number; uploaded: number }> {
    const markdownFiles = this.app.vault.getMarkdownFiles().filter((file) => this.isPathInScope(file.path));
    let uploaded = 0;
    this.updateStatus(this.t("scanning", { count: markdownFiles.length }));
    for (const file of markdownFiles) {
      uploaded += await this.processFile(file, false);
    }
    this.updateStatus(this.t("scannedStatus", { scanned: markdownFiles.length, uploaded }));
    if (manual && uploaded === 0) {
      this.updateStatus(`${this.lastStatus} ${this.t("noLocalImagesFound")}`);
    }
    return { scanned: markdownFiles.length, uploaded };
  }

  private isPathInScope(path: string): boolean {
    const normalized = normalizePath(path);
    for (const folder of this.settings.excludeFolders) {
      const clean = normalizePath(folder);
      if (clean && (normalized === clean || normalized.startsWith(`${clean}/`))) return false;
    }

    if (this.settings.scanScopeMode === "vault") return true;

    return this.settings.includeFolders.some((folder) => {
      const clean = normalizePath(folder);
      return clean && (normalized === clean || normalized.startsWith(`${clean}/`));
    });
  }

  private async getEffectiveSettings(): Promise<R2MediaSyncSettings> {
    if (this.settings.configSource === "manual") {
      this.validateR2Settings(this.settings);
      return this.settings;
    }

    try {
      const imported = await this.readEzImageSettings();
      return Object.assign({}, this.settings, imported);
    } catch {
      this.validateR2Settings(this.settings);
      return this.settings;
    }
  }

  private validateR2Settings(settings: R2MediaSyncSettings): void {
    const missing = [
      ["accountId", settings.accountId],
      ["accessKeyId", settings.accessKeyId],
      ["secretAccessKey", settings.secretAccessKey],
      ["bucketName", settings.bucketName],
      ["publicUrl", settings.publicUrl],
    ].filter(([, value]) => !value);

    if (missing.length) {
      throw new Error(`Missing R2 settings: ${missing.map(([key]) => key).join(", ")}`);
    }
  }

  private async readEzImageSettings(): Promise<Partial<R2MediaSyncSettings>> {
    const configDir = this.app.vault.configDir;
    const raw = await this.app.vault.adapter.read(`${configDir}/plugins/ezimage/data.json`);
    const data = parseEzImageSettings(raw);
    const r2 = data.r2;
    return {
      accountId: r2.accountId,
      accessKeyId: r2.accessKeyId,
      secretAccessKey: r2.secretAccessKey,
      bucketName: r2.bucketName,
      publicUrl: String(r2.publicUrl).replace(/\/$/, ""),
      pathTemplate: data.pathTemplate || this.settings.pathTemplate || DEFAULT_SETTINGS.pathTemplate,
    };
  }

  async importEzImageSettings(showNotice: boolean): Promise<void> {
    try {
      const imported = await this.readEzImageSettings();
      Object.assign(this.settings, imported, { configSource: "manual" as ConfigSource });
      await this.saveSettings();
      if (showNotice) new Notice(`R2 Media Sync: ${this.t("importedEzImage")}`);
    } catch (error) {
      this.reportError(this.t("importEzImageFailed"), error, showNotice);
    }
  }

  private async resolveImage(markdownFile: TFile, rawTarget: string): Promise<TFile | null> {
    const clean = stripAngleBrackets(decodeURIComponent(rawTarget.trim().split("|", 1)[0]));
    if (!clean || isRemote(clean) || clean.startsWith("#")) return null;

    const linkedImage = this.app.metadataCache.getFirstLinkpathDest(clean, markdownFile.path);
    if (linkedImage instanceof TFile && IMAGE_EXTS.has(linkedImage.extension.toLowerCase())) return linkedImage;

    const parentPath = markdownFile.parent?.path ?? "";
    const relativePath = normalizePath(parentPath ? `${parentPath}/${clean}` : clean);
    const relativeImage = this.app.vault.getAbstractFileByPath(relativePath);
    if (relativeImage instanceof TFile && IMAGE_EXTS.has(relativeImage.extension.toLowerCase())) return relativeImage;

    const absoluteImage = this.app.vault.getAbstractFileByPath(normalizePath(clean));
    if (absoluteImage instanceof TFile && IMAGE_EXTS.has(absoluteImage.extension.toLowerCase())) return absoluteImage;

    return null;
  }

  async processFile(markdownFile: TFile, manual: boolean): Promise<number> {
    if (markdownFile.extension !== "md" || this.processing.has(markdownFile.path)) return 0;
    if (!this.isPathInScope(markdownFile.path)) return 0;

    this.processing.add(markdownFile.path);
    try {
      const settings = await this.getEffectiveSettings();
      const original = await this.app.vault.read(markdownFile);
      const replacements: Replacement[] = [];
      const uploaded = new Map<string, string>();
      this.updateStatus(this.t("processing", { path: markdownFile.path }));

      if (settings.processMarkdownImages) {
        for (const match of original.matchAll(MARKDOWN_IMAGE_RE)) {
          const image = await this.resolveImage(markdownFile, match[2]);
          if (!image || !this.isPathInScope(image.path)) continue;
          if (!uploaded.has(image.path)) uploaded.set(image.path, await this.uploadImage(image, settings, markdownFile.path));
          const alt = match[1] || "image";
          replacements.push({
            start: match.index ?? 0,
            end: (match.index ?? 0) + match[0].length,
            text: `![${alt}](${uploaded.get(image.path)})`,
            image,
          });
        }
      }

      if (settings.processWikiImages) {
        for (const match of original.matchAll(WIKILINK_IMAGE_RE)) {
          const image = await this.resolveImage(markdownFile, match[1]);
          if (!image || !this.isPathInScope(image.path)) continue;
          if (!uploaded.has(image.path)) uploaded.set(image.path, await this.uploadImage(image, settings, markdownFile.path));
          replacements.push({
            start: match.index ?? 0,
            end: (match.index ?? 0) + match[0].length,
            text: `![image](${uploaded.get(image.path)})`,
            image,
          });
        }
      }

      if (!replacements.length) {
        if (manual) new Notice(`R2 Media Sync: ${this.t("noLocalImagesFound")}`);
        this.updateStatus(this.t("noLocalImagesIn", { path: markdownFile.path }));
        return 0;
      }

      let rewritten = original;
      for (const item of replacements.sort((a, b) => b.start - a.start)) {
        rewritten = rewritten.slice(0, item.start) + item.text + rewritten.slice(item.end);
      }
      await this.app.vault.modify(markdownFile, rewritten);

      if (settings.deleteLocalAfterUpload) {
        const deleted = new Set<string>();
        for (const item of replacements) {
          if (deleted.has(item.image.path)) continue;
          deleted.add(item.image.path);
          const image = this.app.vault.getAbstractFileByPath(item.image.path);
          if (image instanceof TFile) {
            try {
              await this.app.fileManager.trashFile(image);
            } catch (error) {
              throw new Error(
                `Uploaded and rewrote links, but failed to delete local image: ${item.image.path}. ` +
                (error instanceof Error ? error.message : String(error)),
              );
            }
          }
        }
      }

      this.updateStatus(this.t("uploadedFor", { count: uploaded.size, path: markdownFile.path }));
      new Notice(`R2 Media Sync: ${this.t("uploadedNotice", { count: uploaded.size })}`);
      return uploaded.size;
    } catch (error) {
      this.reportError(this.t("syncFailed"), error, manual);
      return 0;
    } finally {
      this.processing.delete(markdownFile.path);
    }
  }

  private async uploadImage(file: TFile, settings: R2MediaSyncSettings, markdownPath: string): Promise<string> {
    const data = await this.app.vault.readBinary(file);
    const hash = sha256Hex(Buffer.from(data));
    if (settings.reuseUploadedByHash) {
      const history = await this.readUploadHistory();
      const existing = history[hash];
      if (existing) {
        this.updateStatus(this.t("reusedUrl", { path: file.path }));
        return existing.url;
      }
    }

    const key = objectKeyFor(file.name, settings.pathTemplate);
    const url = await this.uploadToR2WithRetry(data, file.name, key, settings, markdownPath, file.path);
    if (settings.reuseUploadedByHash) {
      const history = await this.readUploadHistory();
      history[hash] = {
        fileName: file.name,
        key,
        size: file.stat.size,
        uploadedAt: new Date().toISOString(),
        url,
      };
      await this.writeJsonFile(UPLOAD_HISTORY_LOG, history);
    }
    return url;
  }

  private async uploadToR2WithRetry(
    arrayBuffer: ArrayBuffer,
    fileName: string,
    key: string,
    settings: R2MediaSyncSettings,
    markdownPath: string,
    imagePath: string,
  ): Promise<string> {
    const attempts = Math.max(1, Math.floor(settings.maxUploadAttempts || 1));
    let lastError: unknown;

    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        if (attempt > 1) this.updateStatus(this.t("retrying", { path: imagePath, attempt, attempts }));
        return await this.uploadToR2(arrayBuffer, fileName, key, settings);
      } catch (error) {
        lastError = error;
        if (attempt < attempts) await sleep(1000 * Math.pow(2, attempt - 1));
      }
    }

    const message = lastError instanceof Error ? lastError.message : String(lastError);
    await this.recordFailedUpload({
      time: new Date().toISOString(),
      markdownPath,
      imagePath,
      message,
      attempts,
    });
    throw new Error(`${message} (${attempts} attempt${attempts === 1 ? "" : "s"})`);
  }

  private async uploadToR2(
    arrayBuffer: ArrayBuffer,
    fileName: string,
    key: string,
    settings: R2MediaSyncSettings,
  ): Promise<string> {
    const payload = Buffer.from(arrayBuffer);
    const contentType = mimeType(fileName);
    const host = `${settings.accountId}.r2.cloudflarestorage.com`;
    const endpoint = `https://${host}/${encodeURIComponent(settings.bucketName)}/${encodeKey(key)}`;
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
    const dateStamp = amzDate.slice(0, 8);
    const payloadHash = sha256Hex(payload);
    const canonicalUri = `/${encodeURIComponent(settings.bucketName)}/${encodeKey(key)}`;
    const canonicalHeaders =
      `content-type:${contentType}\n` +
      `host:${host}\n` +
      `x-amz-content-sha256:${payloadHash}\n` +
      `x-amz-date:${amzDate}\n`;
    const signedHeaders = "content-type;host;x-amz-content-sha256;x-amz-date";
    const canonicalRequest = [
      "PUT",
      canonicalUri,
      "",
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join("\n");
    const credentialScope = `${dateStamp}/auto/s3/aws4_request`;
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      amzDate,
      credentialScope,
      sha256Hex(Buffer.from(canonicalRequest, "utf8")),
    ].join("\n");
    const signature = crypto
      .createHmac("sha256", signingKey(settings.secretAccessKey, dateStamp, "auto", "s3"))
      .update(stringToSign, "utf8")
      .digest("hex");
    const authorization =
      "AWS4-HMAC-SHA256 " +
      `Credential=${settings.accessKeyId}/${credentialScope}, ` +
      `SignedHeaders=${signedHeaders}, ` +
      `Signature=${signature}`;

    const response = await requestUrl({
      url: endpoint,
      method: "PUT",
      headers: {
        Authorization: authorization,
        "Content-Type": contentType,
        "X-Amz-Content-Sha256": payloadHash,
        "X-Amz-Date": amzDate,
      },
      body: arrayBuffer,
      throw: false,
    });

    if (response.status < 200 || response.status >= 300) {
      throw new Error(`R2 upload failed (${response.status}): ${response.text.slice(0, 300)}`);
    }

    return `${settings.publicUrl.replace(/\/$/, "")}/${encodeKey(key)}`;
  }

  private pluginDataPath(fileName: string): string {
    return `${this.app.vault.configDir}/plugins/${this.manifest.id}/${fileName}`;
  }

  private async readJsonFile<T>(fileName: string, fallback: T): Promise<T> {
    try {
      const raw = await this.app.vault.adapter.read(this.pluginDataPath(fileName));
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }

  private async writeJsonFile(fileName: string, value: unknown): Promise<void> {
    await this.app.vault.adapter.write(this.pluginDataPath(fileName), `${JSON.stringify(value, null, 2)}\n`);
  }

  private async readUploadHistory(): Promise<Record<string, UploadHistoryEntry>> {
    return this.readJsonFile<Record<string, UploadHistoryEntry>>(UPLOAD_HISTORY_LOG, {});
  }

  private async readFailedUploads(): Promise<FailedUploadEntry[]> {
    return this.readJsonFile<FailedUploadEntry[]>(FAILED_UPLOAD_LOG, []);
  }

  private async recordFailedUpload(entry: FailedUploadEntry): Promise<void> {
    const failed = await this.readFailedUploads();
    failed.push(entry);
    await this.writeJsonFile(FAILED_UPLOAD_LOG, failed.slice(-MAX_FAILED_UPLOADS));
    this.updateStatus(this.t("recordedFailedUpload", { path: entry.imagePath }));
  }

  reportError(prefix: string, error: unknown, showNotice = true): void {
    const message = error instanceof Error ? error.message : String(error);
    this.updateStatus(`${prefix}: ${message}`);
    console.error(prefix, error);
    if (showNotice) new Notice(`${prefix}: ${message}`);
  }
}

class R2MediaSyncSettingTab extends PluginSettingTab {
  plugin: R2MediaSyncPlugin;

  constructor(app: App, plugin: R2MediaSyncPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName(this.plugin.t("languageName"))
      .setDesc(this.plugin.t("languageDesc"))
      .addDropdown((dropdown) => dropdown
        .addOption("auto", this.plugin.t("languageAuto"))
        .addOption("en", this.plugin.t("languageEnglish"))
        .addOption("zh-TW", this.plugin.t("languageTraditionalChinese"))
        .setValue(this.plugin.settings.uiLanguage)
        .onChange(async (value: UiLanguage) => {
          this.plugin.settings.uiLanguage = value;
          await this.plugin.saveSettings();
          this.display();
        }));

    new Setting(containerEl)
      .setName(this.plugin.t("r2SourceName"))
      .setDesc(this.plugin.t("r2SourceDesc"))
      .addDropdown((dropdown) => dropdown
        .addOption("ezimage", this.plugin.t("readFromEzImage"))
        .addOption("manual", this.plugin.t("manual"))
        .setValue(this.plugin.settings.configSource)
        .onChange(async (value: ConfigSource) => {
          this.plugin.settings.configSource = value;
          await this.plugin.saveSettings();
          this.display();
        }));

    new Setting(containerEl)
      .setName(this.plugin.t("importFromEzImageName"))
      .setDesc(this.plugin.t("importFromEzImageDesc"))
      .addButton((button) => button
        .setButtonText(this.plugin.t("importButton"))
        .onClick(async () => {
          await this.plugin.importEzImageSettings(true);
          this.display();
        }));

    if (this.plugin.settings.configSource === "manual") {
      this.addTextSetting(this.plugin.t("accountIdName"), this.plugin.t("accountIdDesc"), "accountId");
      this.addTextSetting(this.plugin.t("accessKeyIdName"), this.plugin.t("accessKeyIdDesc"), "accessKeyId");
      this.addTextSetting(this.plugin.t("secretAccessKeyName"), this.plugin.t("secretAccessKeyDesc"), "secretAccessKey", true);
      this.addTextSetting(this.plugin.t("bucketNameName"), this.plugin.t("bucketNameDesc"), "bucketName");
      this.addTextSetting(this.plugin.t("publicUrlName"), this.plugin.t("publicUrlDesc"), "publicUrl");
    }

    this.addTextSetting(
      this.plugin.t("pathTemplateName"),
      this.plugin.t("pathTemplateDesc"),
      "pathTemplate",
    );

    new Setting(containerEl)
      .setName(this.plugin.t("deleteLocalName"))
      .setDesc(this.plugin.t("deleteLocalDesc"))
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.deleteLocalAfterUpload)
        .onChange(async (value) => {
          this.plugin.settings.deleteLocalAfterUpload = value;
          await this.plugin.saveSettings();
          if (value) {
            new Notice(`R2 Media Sync: ${this.plugin.t("deleteEnabledNotice")}`);
          }
        }));

    new Setting(containerEl)
      .setName(this.plugin.t("reuseHashName"))
      .setDesc(this.plugin.t("reuseHashDesc"))
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.reuseUploadedByHash)
        .onChange(async (value) => {
          this.plugin.settings.reuseUploadedByHash = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName(this.plugin.t("processMarkdownName"))
      .setDesc(this.plugin.t("processMarkdownDesc"))
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.processMarkdownImages)
        .onChange(async (value) => {
          this.plugin.settings.processMarkdownImages = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName(this.plugin.t("processWikiName"))
      .setDesc(this.plugin.t("processWikiDesc"))
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.processWikiImages)
        .onChange(async (value) => {
          this.plugin.settings.processWikiImages = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName(this.plugin.t("scanStartupName"))
      .setDesc(this.plugin.t("scanStartupDesc"))
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.processOnStartup)
        .onChange(async (value) => {
          this.plugin.settings.processOnStartup = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName(this.plugin.t("scanScopeName"))
      .setDesc(this.plugin.t("scanScopeDesc"))
      .addDropdown((dropdown) => dropdown
        .addOption("vault", this.plugin.t("wholeVault"))
        .addOption("folders", this.plugin.t("includedFoldersOnly"))
        .setValue(this.plugin.settings.scanScopeMode)
        .onChange(async (value: ScanScopeMode) => {
          this.plugin.settings.scanScopeMode = value;
          await this.plugin.saveSettings();
          this.display();
        }));

    if (this.plugin.settings.scanScopeMode === "folders") {
      new Setting(containerEl)
        .setName(this.plugin.t("includedFoldersName"))
        .setDesc(this.plugin.t("includedFoldersDesc"))
        .addTextArea((text) => text
          .setValue(joinList(this.plugin.settings.includeFolders))
          .onChange(async (value) => {
            this.plugin.settings.includeFolders = splitList(value);
            await this.plugin.saveSettings();
          }));
    }

    new Setting(containerEl)
      .setName(this.plugin.t("excludedFoldersName"))
      .setDesc(this.plugin.t("excludedFoldersDesc"))
      .addTextArea((text) => text
        .setValue(joinList(this.plugin.settings.excludeFolders))
        .onChange(async (value) => {
          this.plugin.settings.excludeFolders = splitList(value);
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName(this.plugin.t("debounceName"))
      .setDesc(this.plugin.t("debounceDesc"))
      .addText((text) => text
        .setValue(String(this.plugin.settings.debounceMs))
        .onChange(async (value) => {
          const parsed = Number.parseInt(value, 10);
          if (!Number.isNaN(parsed) && parsed >= 500) {
            this.plugin.settings.debounceMs = parsed;
            await this.plugin.saveSettings();
          }
        }));

    new Setting(containerEl)
      .setName(this.plugin.t("retryAttemptsName"))
      .setDesc(this.plugin.t("retryAttemptsDesc"))
      .addText((text) => text
        .setValue(String(this.plugin.settings.maxUploadAttempts))
        .onChange(async (value) => {
          const parsed = Number.parseInt(value, 10);
          if (!Number.isNaN(parsed) && parsed >= 1 && parsed <= 10) {
            this.plugin.settings.maxUploadAttempts = parsed;
            await this.plugin.saveSettings();
          }
        }));

    new Setting(containerEl)
      .setName(this.plugin.t("scanNowName"))
      .setDesc(this.plugin.t("scanNowDesc"))
      .addButton((button) => button
        .setButtonText(this.plugin.t("scanButton"))
        .setCta()
        .onClick(async () => {
          const result = await this.plugin.scanConfiguredScope(true);
          new Notice(`R2 Media Sync: ${this.plugin.t("scannedNotice", { scanned: result.scanned, uploaded: result.uploaded })}`);
          this.display();
        }));

    const status = containerEl.createDiv({ cls: "r2-media-sync-status" });
    status.setText(this.plugin.getLastStatus() || this.plugin.t("noRecentActivity"));
  }

  private addTextSetting(
    name: string,
    desc: string,
    key: keyof Pick<R2MediaSyncSettings, "accountId" | "accessKeyId" | "secretAccessKey" | "bucketName" | "publicUrl" | "pathTemplate">,
    password = false,
  ): void {
    new Setting(this.containerEl)
      .setName(name)
      .setDesc(desc)
      .addText((text) => {
        text.setValue(String(this.plugin.settings[key] ?? ""))
          .onChange(async (value) => {
            this.plugin.settings[key] = value.trim();
            await this.plugin.saveSettings();
          });
        if (password) text.inputEl.type = "password";
      });
  }
}
