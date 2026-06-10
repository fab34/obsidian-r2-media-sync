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

interface R2MediaSyncSettings {
  configSource: ConfigSource;
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
  publicUrl: string;
  pathTemplate: string;
  deleteLocalAfterUpload: boolean;
  processMarkdownImages: boolean;
  processWikiImages: boolean;
  processOnStartup: boolean;
  scanScopeMode: ScanScopeMode;
  includeFolders: string[];
  excludeFolders: string[];
  debounceMs: number;
}

const DEFAULT_SETTINGS: R2MediaSyncSettings = {
  configSource: "ezimage",
  accountId: "",
  accessKeyId: "",
  secretAccessKey: "",
  bucketName: "",
  publicUrl: "",
  pathTemplate: "{yyyy}/{MM}/{timestamp}-{random}.{ext}",
  deleteLocalAfterUpload: true,
  processMarkdownImages: true,
  processWikiImages: true,
  processOnStartup: true,
  scanScopeMode: "vault",
  includeFolders: ["AI 工作區"],
  excludeFolders: [".obsidian", ".git", ".trash", "Templates"],
  debounceMs: 4000,
};

const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"]);
const MARKDOWN_IMAGE_RE = /!\[([^\]]*)\]\(([^)]+)\)/g;
const WIKILINK_IMAGE_RE = /!\[\[([^\]]+\.(?:png|jpe?g|gif|webp|bmp|svg))(?:\|[^\]]*)?\]\]/gi;

function hmac(key: crypto.BinaryLike, value: string): Buffer {
  return crypto.createHmac("sha256", key).update(value, "utf8").digest();
}

function sha256Hex(value: crypto.BinaryLike): string {
  return crypto.createHash("sha256").update(value).digest("hex");
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

export default class R2MediaSyncPlugin extends Plugin {
  settings: R2MediaSyncSettings;
  private queue = new Map<string, number>();
  private processing = new Set<string>();
  private lastStatus = "";

  async onload(): Promise<void> {
    await this.loadSettings();

    this.addSettingTab(new R2MediaSyncSettingTab(this.app, this));

    this.addCommand({
      id: "process-current-note",
      name: "Upload local images in current note",
      callback: async () => {
        const file = this.app.workspace.getActiveFile();
        if (file) {
          await this.processFile(file, true);
        } else {
          new Notice("R2 Media Sync: no active note.");
        }
      },
    });

    this.addCommand({
      id: "scan-configured-scope",
      name: "Scan configured scope now",
      callback: async () => {
        const result = await this.scanConfiguredScope(true);
        new Notice(`R2 Media Sync: scanned ${result.scanned} Markdown file(s), uploaded ${result.uploaded} image(s).`);
      },
    });

    this.addCommand({
      id: "import-ezimage-settings",
      name: "Import settings from EzImage",
      callback: async () => {
        await this.importEzImageSettings(true);
      },
    });

    this.registerEvent(this.app.vault.on("create", (file) => this.handleVaultEvent(file)));
    this.registerEvent(this.app.vault.on("modify", (file) => this.handleVaultEvent(file)));

    this.app.workspace.onLayoutReady(() => {
      if (this.settings.processOnStartup) {
        this.scanConfiguredScope(false).catch((error) => this.reportError("Startup scan failed", error));
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
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
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
    const timeoutId = window.setTimeout(async () => {
      this.queue.delete(path);
      const file = this.app.vault.getAbstractFileByPath(path);
      if (file instanceof TFile) await this.processFile(file, false);
    }, Math.max(500, delayMs));
    this.queue.set(path, timeoutId);
  }

  async scanConfiguredScope(manual: boolean): Promise<{ scanned: number; uploaded: number }> {
    const markdownFiles = this.app.vault.getMarkdownFiles().filter((file) => this.isPathInScope(file.path));
    let uploaded = 0;
    for (const file of markdownFiles) {
      uploaded += await this.processFile(file, false);
    }
    this.lastStatus = `Scanned ${markdownFiles.length} Markdown file(s), uploaded ${uploaded} image(s).`;
    if (manual && uploaded === 0) {
      this.lastStatus += " No local images found.";
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
    } catch (error) {
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
    const raw = await this.app.vault.adapter.read(".obsidian/plugins/ezimage/data.json");
    const data = JSON.parse(raw);
    const r2 = data.r2 ?? {};
    for (const key of ["accountId", "accessKeyId", "secretAccessKey", "bucketName", "publicUrl"]) {
      if (!r2[key]) throw new Error(`EzImage R2 setting missing: ${key}`);
    }
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
      if (showNotice) new Notice("R2 Media Sync: imported EzImage R2 settings.");
    } catch (error) {
      this.reportError("Could not import EzImage settings", error, showNotice);
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

      if (settings.processMarkdownImages) {
        for (const match of original.matchAll(MARKDOWN_IMAGE_RE)) {
          const image = await this.resolveImage(markdownFile, match[2]);
          if (!image || !this.isPathInScope(image.path)) continue;
          if (!uploaded.has(image.path)) uploaded.set(image.path, await this.uploadImage(image, settings));
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
          if (!uploaded.has(image.path)) uploaded.set(image.path, await this.uploadImage(image, settings));
          replacements.push({
            start: match.index ?? 0,
            end: (match.index ?? 0) + match[0].length,
            text: `![image](${uploaded.get(image.path)})`,
            image,
          });
        }
      }

      if (!replacements.length) {
        if (manual) new Notice("R2 Media Sync: no local images found.");
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
          if (image instanceof TFile) await this.app.vault.delete(image);
        }
      }

      this.lastStatus = `Uploaded ${uploaded.size} image(s) for ${markdownFile.path}`;
      new Notice(`R2 Media Sync: uploaded ${uploaded.size} image(s).`);
      return uploaded.size;
    } catch (error) {
      this.reportError("R2 Media Sync failed", error, manual);
      return 0;
    } finally {
      this.processing.delete(markdownFile.path);
    }
  }

  private async uploadImage(file: TFile, settings: R2MediaSyncSettings): Promise<string> {
    const data = await this.app.vault.readBinary(file);
    const key = objectKeyFor(file.name, settings.pathTemplate);
    return this.uploadToR2(data, file.name, key, settings);
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

  reportError(prefix: string, error: unknown, showNotice = true): void {
    const message = error instanceof Error ? error.message : String(error);
    this.lastStatus = `${prefix}: ${message}`;
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

    containerEl.createEl("h2", { text: "R2 Media Sync" });

    new Setting(containerEl)
      .setName("R2 settings source")
      .setDesc("Use EzImage settings when available, or store R2 credentials in this plugin.")
      .addDropdown((dropdown) => dropdown
        .addOption("ezimage", "Read from EzImage")
        .addOption("manual", "Manual")
        .setValue(this.plugin.settings.configSource)
        .onChange(async (value: ConfigSource) => {
          this.plugin.settings.configSource = value;
          await this.plugin.saveSettings();
          this.display();
        }));

    new Setting(containerEl)
      .setName("Import from EzImage")
      .setDesc("Copy EzImage's R2 settings into this plugin, then switch to Manual.")
      .addButton((button) => button
        .setButtonText("Import")
        .onClick(async () => {
          await this.plugin.importEzImageSettings(true);
          this.display();
        }));

    if (this.plugin.settings.configSource === "manual") {
      this.addTextSetting("Cloudflare account ID", "R2 account ID.", "accountId");
      this.addTextSetting("Access key ID", "R2 access key ID.", "accessKeyId");
      this.addTextSetting("Secret access key", "R2 secret access key.", "secretAccessKey", true);
      this.addTextSetting("Bucket name", "Target R2 bucket.", "bucketName");
      this.addTextSetting("Public URL", "Public bucket URL or custom domain, without trailing slash.", "publicUrl");
    }

    this.addTextSetting(
      "Path template",
      "Supported tokens: {yyyy}, {MM}, {dd}, {hh}, {mm}, {ss}, {timestamp}, {random}, {name}, {ext}.",
      "pathTemplate",
    );

    new Setting(containerEl)
      .setName("Delete local image after upload")
      .setDesc("Recommended for keeping iCloud vaults small. Disable this if you want local copies.")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.deleteLocalAfterUpload)
        .onChange(async (value) => {
          this.plugin.settings.deleteLocalAfterUpload = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Process Markdown image links")
      .setDesc("Process links like ![](image.png).")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.processMarkdownImages)
        .onChange(async (value) => {
          this.plugin.settings.processMarkdownImages = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Process wiki image embeds")
      .setDesc("Process links like ![[image.png]].")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.processWikiImages)
        .onChange(async (value) => {
          this.plugin.settings.processWikiImages = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Scan on startup")
      .setDesc("Scan the configured scope when Obsidian starts.")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.processOnStartup)
        .onChange(async (value) => {
          this.plugin.settings.processOnStartup = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Scan scope")
      .setDesc("Scan the whole vault, or only specific top-level/project folders.")
      .addDropdown((dropdown) => dropdown
        .addOption("vault", "Whole vault")
        .addOption("folders", "Only included folders")
        .setValue(this.plugin.settings.scanScopeMode)
        .onChange(async (value: ScanScopeMode) => {
          this.plugin.settings.scanScopeMode = value;
          await this.plugin.saveSettings();
          this.display();
        }));

    if (this.plugin.settings.scanScopeMode === "folders") {
      new Setting(containerEl)
        .setName("Included folders")
        .setDesc("Comma-separated vault-relative folders.")
        .addTextArea((text) => text
          .setValue(joinList(this.plugin.settings.includeFolders))
          .onChange(async (value) => {
            this.plugin.settings.includeFolders = splitList(value);
            await this.plugin.saveSettings();
          }));
    }

    new Setting(containerEl)
      .setName("Excluded folders")
      .setDesc("Comma-separated vault-relative folders. Defaults protect .obsidian, .git, trash, and Templates.")
      .addTextArea((text) => text
        .setValue(joinList(this.plugin.settings.excludeFolders))
        .onChange(async (value) => {
          this.plugin.settings.excludeFolders = splitList(value);
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Debounce delay")
      .setDesc("Milliseconds to wait after file changes before processing.")
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
      .setName("Scan now")
      .setDesc("Scan the configured scope immediately.")
      .addButton((button) => button
        .setButtonText("Scan")
        .setCta()
        .onClick(async () => {
          const result = await this.plugin.scanConfiguredScope(true);
          new Notice(`R2 Media Sync: scanned ${result.scanned} Markdown file(s), uploaded ${result.uploaded} image(s).`);
          this.display();
        }));

    const status = containerEl.createDiv({ cls: "r2-media-sync-status" });
    status.setText(this.plugin["lastStatus"] || "No recent activity.");
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
