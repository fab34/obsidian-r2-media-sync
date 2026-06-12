import {
  App,
  Modal,
  Notice,
  Platform,
  Plugin,
  PluginSettingTab,
  requestUrl,
  Setting,
  setIcon,
  TFile,
  TFolder,
  normalizePath,
} from "obsidian";

type ConfigSource = "manual" | "ezimage";
type ScanScopeMode = "vault" | "folders";
type UiLanguage = "auto" | "en" | "zh-TW";
type LocalCleanupMode = "trash" | "folder";

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
  localCleanupMode: LocalCleanupMode;
  localCleanupFolder: string;
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
  localCleanupMode: "trash",
  localCleanupFolder: "_synced_media_trash",
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
  "localCleanupMode",
  "localCleanupFolder",
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
    movedToReviewFolder: "Moved local file to review folder: {path}",
    importedEzImage: "Imported EzImage R2 settings.",
    importEzImageFailed: "Could not import EzImage settings",
    startupScanFailed: "Startup scan failed",
    syncFailed: "R2 Media Sync failed",
    cmdProcessCurrent: "Upload local images in current note",
    cmdScanScope: "Scan configured scope now",
    cmdImportEzImage: "Import settings from EzImage",
    cmdShowFailed: "Show failed upload summary",
    cmdClearFailed: "Clear failed upload log",
    cmdClearReviewFolder: "Clear local review folder",
    failedModalTitle: "Failed uploads",
    failedModalEmpty: "No failed uploads recorded.",
    failedModalIntro: "Recent failed uploads are listed below. Re-scan the note after fixing the underlying issue.",
    failedModalTime: "Time",
    failedModalNote: "Note",
    failedModalImage: "Image",
    failedModalAttempts: "Attempts",
    failedModalMessage: "Message",
    closeButton: "Close",
    clearReviewTitle: "Clear local review folder",
    clearReviewEmpty: "No files found in the local review folder.",
    clearReviewConfirm: "Move {count} file(s) from {folder} to Obsidian trash?",
    clearReviewButton: "Clear",
    clearReviewDone: "Moved {count} review file(s) to trash.",
    cancelButton: "Cancel",
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
    cleanupModeName: "Local cleanup mode",
    cleanupModeDesc: "Choose what happens to local files after upload and link rewrite.",
    cleanupMoveToTrash: "Move to Obsidian trash",
    cleanupMoveToFolder: "Move to review folder",
    cleanupFolderName: "Review folder",
    cleanupFolderDesc: "Vault-relative folder used when cleanup mode is set to review folder.",
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
    webCryptoUnavailable: "Web Crypto is unavailable in this Obsidian runtime.",
    mobileManualOnly: "Mobile runs in current-note mode.",
    statusReadyShort: "Ready",
    statusSyncShort: "Syncing",
    statusDoneShort: "Done",
    statusNoLocalShort: "No local",
    statusIssueShort: "Check",
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
    movedToReviewFolder: "已將本機檔案移到檢查資料夾：{path}",
    importedEzImage: "已匯入 EzImage 的 R2 設定。",
    importEzImageFailed: "無法匯入 EzImage 設定",
    startupScanFailed: "啟動掃描失敗",
    syncFailed: "R2 Media Sync 執行失敗",
    cmdProcessCurrent: "上傳目前筆記中的本機圖片",
    cmdScanScope: "立即掃描設定範圍",
    cmdImportEzImage: "從 EzImage 匯入設定",
    cmdShowFailed: "顯示失敗上傳摘要",
    cmdClearFailed: "清除失敗上傳紀錄",
    cmdClearReviewFolder: "清理本機檢查資料夾",
    failedModalTitle: "失敗上傳",
    failedModalEmpty: "目前沒有失敗上傳紀錄。",
    failedModalIntro: "以下列出最近的失敗上傳。修正原因後，可重新掃描來源筆記。",
    failedModalTime: "時間",
    failedModalNote: "筆記",
    failedModalImage: "圖片",
    failedModalAttempts: "嘗試次數",
    failedModalMessage: "訊息",
    closeButton: "關閉",
    clearReviewTitle: "清理本機檢查資料夾",
    clearReviewEmpty: "本機檢查資料夾沒有檔案。",
    clearReviewConfirm: "要將 {folder} 中的 {count} 個檔案移到 Obsidian 垃圾桶嗎？",
    clearReviewButton: "清理",
    clearReviewDone: "已將 {count} 個檢查檔案移到垃圾桶。",
    cancelButton: "取消",
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
    cleanupModeName: "本機清理方式",
    cleanupModeDesc: "選擇成功上傳並改寫連結後，要如何處理本機檔案。",
    cleanupMoveToTrash: "移到 Obsidian 垃圾桶",
    cleanupMoveToFolder: "移到檢查資料夾",
    cleanupFolderName: "檢查資料夾",
    cleanupFolderDesc: "當清理方式設為檢查資料夾時使用的 vault 相對資料夾。",
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
    webCryptoUnavailable: "目前的 Obsidian 執行環境無法使用 Web Crypto。",
    mobileManualOnly: "手機版使用目前筆記處理模式。",
    statusReadyShort: "就緒",
    statusSyncShort: "同步中",
    statusDoneShort: "完成",
    statusNoLocalShort: "無本機圖",
    statusIssueShort: "查看",
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

function bytesToHex(value: ArrayBuffer): string {
  return Array.from(new Uint8Array(value))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function encodeUtf8(value: string): ArrayBuffer {
  return new TextEncoder().encode(value).buffer as ArrayBuffer;
}

function requireWebCrypto(): SubtleCrypto {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("Web Crypto is unavailable in this Obsidian runtime.");
  return subtle;
}

async function sha256Hex(value: ArrayBuffer | string): Promise<string> {
  const data = typeof value === "string" ? encodeUtf8(value) : value;
  return bytesToHex(await requireWebCrypto().digest("SHA-256", data));
}

async function hmacSha256(key: ArrayBuffer, value: string): Promise<ArrayBuffer> {
  const subtle = requireWebCrypto();
  const cryptoKey = await subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return subtle.sign("HMAC", cryptoKey, encodeUtf8(value));
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
      case "localCleanupMode":
        if (raw === "trash" || raw === "folder") parsed.localCleanupMode = raw;
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
        if (typeof raw === "string") parsed[key as keyof Pick<R2MediaSyncSettings, "accountId" | "accessKeyId" | "secretAccessKey" | "bucketName" | "publicUrl" | "pathTemplate" | "localCleanupFolder">] = raw;
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

async function signingKey(secret: string, dateStamp: string, region: string, service: string): Promise<ArrayBuffer> {
  const dateKey = await hmacSha256(encodeUtf8(`AWS4${secret}`), dateStamp);
  const regionKey = await hmacSha256(dateKey, region);
  const serviceKey = await hmacSha256(regionKey, service);
  return hmacSha256(serviceKey, "aws4_request");
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

    if (!Platform.isMobile) {
      this.statusBarEl = this.addStatusBarItem();
      this.statusBarEl.addClass("r2-media-sync-statusbar");
    }
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

    if (Platform.isMobile) {
      new Notice(`R2 Media Sync: ${this.t("mobileManualOnly")}`);
      return;
    }

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
        new FailedUploadsModal(this.app, this, failed).open();
      },
    });

    this.addCommand({
      id: "clear-failed-uploads",
      name: this.t("cmdClearFailed"),
      callback: async () => {
        await this.writeJsonFile(FAILED_UPLOAD_LOG, []);
        this.updateStatus(this.t("failedUploadLogCleared"), this.t("statusDoneShort"));
        new Notice(`R2 Media Sync: ${this.t("failedUploadLogCleared")}`);
      },
    });

    this.addCommand({
      id: "clear-local-review-folder",
      name: this.t("cmdClearReviewFolder"),
      callback: async () => {
        const files = this.getReviewFolderFiles();
        if (!files.length) {
          new Notice(`R2 Media Sync: ${this.t("clearReviewEmpty")}`);
          return;
        }

        new ConfirmModal(
          this.app,
          this,
          this.t("clearReviewTitle"),
          this.t("clearReviewConfirm", {
            count: files.length,
            folder: normalizePath(this.settings.localCleanupFolder || DEFAULT_SETTINGS.localCleanupFolder),
          }),
          this.t("clearReviewButton"),
          async () => {
            const count = await this.clearReviewFolder(files);
            new Notice(`R2 Media Sync: ${this.t("clearReviewDone", { count })}`);
          },
        ).open();
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

  private updateStatus(message: string, shortMessage = this.shortStatus(message)): void {
    this.lastStatus = message;
    if (this.statusBarEl) {
      this.statusBarEl.empty();
      const iconEl = this.statusBarEl.createSpan({ cls: "r2-media-sync-statusbar-icon" });
      setIcon(iconEl, "cloud-upload");
      this.statusBarEl.createSpan({
        cls: "r2-media-sync-statusbar-text",
        text: shortMessage,
      });
      this.statusBarEl.title = `R2 Media Sync: ${message}`;
    }
  }

  private shortStatus(message: string): string {
    if (message === this.t("idle")) return this.t("statusReadyShort");
    if (
      message.includes(this.t("noLocalImagesFound")) ||
      message.includes("No local images") ||
      message.includes("沒有找到本機圖片")
    ) {
      return this.t("statusNoLocalShort");
    }
    if (
      message.includes("failed") ||
      message.includes("Missing") ||
      message.includes("無法") ||
      message.includes("失敗")
    ) {
      return this.t("statusIssueShort");
    }
    if (
      message.includes("Scanning") ||
      message.includes("Processing") ||
      message.includes("Retrying") ||
      message.includes("正在")
    ) {
      return this.t("statusSyncShort");
    }
    return this.t("statusDoneShort");
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
              await this.cleanupLocalImage(image, settings);
            } catch (error) {
              throw new Error(
                `Uploaded and rewrote links, but failed to clean up local image: ${item.image.path}. ` +
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

  private async cleanupLocalImage(image: TFile, settings: R2MediaSyncSettings): Promise<void> {
    if (settings.localCleanupMode === "folder") {
      const target = await this.nextReviewFolderPath(image, settings.localCleanupFolder);
      await this.ensureFolder(target.parentPath);
      await this.app.vault.rename(image, target.filePath);
      this.updateStatus(this.t("movedToReviewFolder", { path: target.filePath }));
      return;
    }

    await this.trashLocalFile(image);
  }

  private async trashLocalFile(file: TFile): Promise<void> {
    const originalPath = file.path;
    await this.app.fileManager.trashFile(file);
    if (!this.app.vault.getAbstractFileByPath(originalPath)) return;

    const stillPresent = this.app.vault.getAbstractFileByPath(originalPath);
    if (stillPresent instanceof TFile) {
      await this.app.vault.trash(stillPresent, true);
    }
    if (!this.app.vault.getAbstractFileByPath(originalPath)) return;

    const stillPresentAfterSystemTrash = this.app.vault.getAbstractFileByPath(originalPath);
    if (stillPresentAfterSystemTrash instanceof TFile) {
      await this.app.vault.trash(stillPresentAfterSystemTrash, false);
    }
    if (this.app.vault.getAbstractFileByPath(originalPath)) {
      throw new Error(`Could not remove local image from vault: ${originalPath}`);
    }
  }

  private async nextReviewFolderPath(image: TFile, folder: string): Promise<{ parentPath: string; filePath: string }> {
    const root = normalizePath(folder || DEFAULT_SETTINGS.localCleanupFolder).replace(/^\/+|\/+$/g, "");
    const rawTarget = normalizePath(`${root}/${image.path}`);
    const parentPath = rawTarget.includes("/") ? rawTarget.slice(0, rawTarget.lastIndexOf("/")) : "";
    const ext = image.extension ? `.${image.extension}` : "";
    const stem = ext ? rawTarget.slice(0, -ext.length) : rawTarget;

    let filePath = rawTarget;
    let index = 1;
    while (await this.app.vault.adapter.exists(filePath)) {
      filePath = `${stem}-${Date.now()}-${index}${ext}`;
      index += 1;
    }

    return {
      parentPath: filePath.includes("/") ? filePath.slice(0, filePath.lastIndexOf("/")) : parentPath,
      filePath,
    };
  }

  private async ensureFolder(path: string): Promise<void> {
    const normalized = normalizePath(path).replace(/^\/+|\/+$/g, "");
    if (!normalized) return;

    let current = "";
    for (const part of normalized.split("/")) {
      current = current ? `${current}/${part}` : part;
      if (!(await this.app.vault.adapter.exists(current))) {
        await this.app.vault.createFolder(current);
      }
    }
  }

  private getReviewFolderFiles(): TFile[] {
    const root = normalizePath(this.settings.localCleanupFolder || DEFAULT_SETTINGS.localCleanupFolder).replace(/^\/+|\/+$/g, "");
    if (!root) return [];
    return this.app.vault.getFiles().filter((file) => file.path === root || file.path.startsWith(`${root}/`));
  }

  private async clearReviewFolder(files: TFile[]): Promise<number> {
    let count = 0;
    for (const file of files) {
      const current = this.app.vault.getAbstractFileByPath(file.path);
      if (current instanceof TFile) {
        await this.trashLocalFile(current);
        count += 1;
      }
    }
    this.updateStatus(this.t("clearReviewDone", { count }));
    return count;
  }

  private async uploadImage(file: TFile, settings: R2MediaSyncSettings, markdownPath: string): Promise<string> {
    const data = await this.app.vault.readBinary(file);
    const hash = await sha256Hex(data);
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
    const contentType = mimeType(fileName);
    const host = `${settings.accountId}.r2.cloudflarestorage.com`;
    const endpoint = `https://${host}/${encodeURIComponent(settings.bucketName)}/${encodeKey(key)}`;
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
    const dateStamp = amzDate.slice(0, 8);
    const payloadHash = await sha256Hex(arrayBuffer);
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
      await sha256Hex(canonicalRequest),
    ].join("\n");
    const keyBytes = await signingKey(settings.secretAccessKey, dateStamp, "auto", "s3");
    const signature = bytesToHex(await hmacSha256(keyBytes, stringToSign));
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

class FailedUploadsModal extends Modal {
  constructor(
    app: App,
    private plugin: R2MediaSyncPlugin,
    private failedUploads: FailedUploadEntry[],
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: this.plugin.t("failedModalTitle") });

    if (!this.failedUploads.length) {
      contentEl.createEl("p", { text: this.plugin.t("failedModalEmpty") });
      this.addCloseButton(contentEl);
      return;
    }

    contentEl.createEl("p", { text: this.plugin.t("failedModalIntro") });
    const list = contentEl.createDiv({ cls: "r2-media-sync-failed-list" });

    for (const entry of this.failedUploads.slice(-20).reverse()) {
      const item = list.createDiv({ cls: "r2-media-sync-failed-item" });
      item.createEl("div", { text: `${this.plugin.t("failedModalTime")}: ${entry.time}` });
      item.createEl("div", { text: `${this.plugin.t("failedModalNote")}: ${entry.markdownPath}` });
      item.createEl("div", { text: `${this.plugin.t("failedModalImage")}: ${entry.imagePath}` });
      item.createEl("div", { text: `${this.plugin.t("failedModalAttempts")}: ${entry.attempts}` });
      item.createEl("div", { text: `${this.plugin.t("failedModalMessage")}: ${entry.message}` });
    }

    this.addCloseButton(contentEl);
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private addCloseButton(contentEl: HTMLElement): void {
    const button = contentEl.createEl("button", { text: this.plugin.t("closeButton") });
    button.addEventListener("click", () => this.close());
  }
}

class ConfirmModal extends Modal {
  constructor(
    app: App,
    private plugin: R2MediaSyncPlugin,
    private title: string,
    private message: string,
    private confirmText: string,
    private onConfirm: () => Promise<void>,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: this.title });
    contentEl.createEl("p", { text: this.message });

    const actions = contentEl.createDiv({ cls: "r2-media-sync-modal-actions" });
    const confirmButton = actions.createEl("button", { text: this.confirmText });
    confirmButton.addClass("mod-cta");
    confirmButton.addEventListener("click", () => {
      void (async () => {
        confirmButton.disabled = true;
        await this.onConfirm();
        this.close();
      })();
    });

    const cancelButton = actions.createEl("button", { text: this.plugin.t("cancelButton") });
    cancelButton.addEventListener("click", () => this.close());
  }

  onClose(): void {
    this.contentEl.empty();
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
          this.display();
        }));

    if (this.plugin.settings.deleteLocalAfterUpload) {
      new Setting(containerEl)
        .setName(this.plugin.t("cleanupModeName"))
        .setDesc(this.plugin.t("cleanupModeDesc"))
        .addDropdown((dropdown) => dropdown
          .addOption("trash", this.plugin.t("cleanupMoveToTrash"))
          .addOption("folder", this.plugin.t("cleanupMoveToFolder"))
          .setValue(this.plugin.settings.localCleanupMode)
          .onChange(async (value: LocalCleanupMode) => {
            this.plugin.settings.localCleanupMode = value;
            await this.plugin.saveSettings();
            this.display();
          }));

      if (this.plugin.settings.localCleanupMode === "folder") {
        this.addTextSetting(
          this.plugin.t("cleanupFolderName"),
          this.plugin.t("cleanupFolderDesc"),
          "localCleanupFolder",
        );
      }
    }

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

    if (Platform.isMobile) {
      const status = containerEl.createDiv({ cls: "r2-media-sync-status" });
      status.setText(this.plugin.t("mobileManualOnly"));
      return;
    }

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
    key: keyof Pick<R2MediaSyncSettings, "accountId" | "accessKeyId" | "secretAccessKey" | "bucketName" | "publicUrl" | "pathTemplate" | "localCleanupFolder">,
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
