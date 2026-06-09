import {
  existsSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import { renderNoteView, type NoteViewMentions } from "../core/note-view-renderer";
import { extractNoteMentions } from "../core/note-mentions";
import { SurfaceMatcher } from "../core/surface-matcher";
import type { PluginSettings } from "../plugin/settings";
import {
  applyStoredConflictResolutions,
  collectMentionEids,
  ensureEntityViews,
  entityLinkTargetForEid,
  ModelStore,
  observeFile,
} from "./model-store";
import {
  loadVaultContext,
  resolveConfiguredPath,
  resolveNotePath,
  type VaultContext,
} from "./plugin-config";

export interface SyncNoteInput {
  vaultDir: string;
  note: string;
}

export interface SyncNoteResult {
  noteId: number;
  viewPath: string;
  databasePath: string;
  rewritten: boolean;
  resolvedCount: number;
  conflictCount: number;
  entityCount: number;
}

export function syncNote(input: SyncNoteInput): SyncNoteResult {
  const context = loadVaultContext(input.vaultDir);
  const notePath = resolveNotePath(context.vaultDir, input.note);
  if (!existsSync(notePath.absolutePath)) {
    throw new Error(`Note does not exist: ${notePath.viewPath}`);
  }
  const runtimeDir = resolveConfiguredPath(
    context.vaultDir,
    context.settings.runtimeDir,
  );
  if (!context.settings.runtimeDir || !SurfaceMatcher.exists(runtimeDir)) {
    throw new Error(
      `Runtime dataset is not configured or missing manifest.json: ${runtimeDir}`,
    );
  }

  const databasePath = resolveConfiguredPath(
    context.vaultDir,
    context.settings.databasePath,
  );
  const store = new ModelStore(databasePath);
  const matcher = SurfaceMatcher.open(runtimeDir);
  try {
    const now = Date.now();
    const noteId = store.ensureNote(notePath.viewPath, now);
    const storedResolutions = store.readConflictResolutions(noteId);
    const originalMarkdown = readFileSync(notePath.absolutePath, "utf8");

    const firstMentions = extractMentions(
      originalMarkdown,
      matcher,
      context,
      store,
      storedResolutions,
    );
    let renderedMarkdown = renderMarkdownWithMentions(
      originalMarkdown,
      firstMentions,
      context.settings,
    );
    let finalMentions = firstMentions;

    // sync 后立刻 react，最终入库的范围必须对应反弹后的 view，而不是外部刚写入的旧文本。
    for (let pass = 0; pass < 3; pass += 1) {
      const nextMentions = extractMentions(
        renderedMarkdown,
        matcher,
        context,
        store,
        storedResolutions,
      );
      const nextRendered = renderMarkdownWithMentions(
        renderedMarkdown,
        nextMentions,
        context.settings,
      );
      finalMentions = nextMentions;
      if (nextRendered === renderedMarkdown) {
        break;
      }
      renderedMarkdown = nextRendered;
    }

    const allEntities = store.ensureEntities(
      collectMentionEids(finalMentions),
      context.settings,
      now,
    );
    ensureEntityViews(
      context.vaultDir,
      allEntities.values(),
      context.settings.preferredLang,
    );

    const rewritten = renderedMarkdown !== originalMarkdown;
    if (rewritten) {
      writeFileAtomically(notePath.absolutePath, renderedMarkdown);
    }

    store.replaceNoteMentions(noteId, finalMentions, allEntities, now);
    store.markNoteSynced(noteId, observeFile(notePath.absolutePath), Date.now());

    return {
      noteId,
      viewPath: notePath.viewPath,
      databasePath,
      rewritten,
      resolvedCount: finalMentions.resolved.length,
      conflictCount: finalMentions.conflicts.length,
      entityCount: allEntities.size,
    };
  } finally {
    matcher.close();
    store.close();
  }
}

function extractMentions(
  markdown: string,
  matcher: SurfaceMatcher,
  context: VaultContext,
  store: ModelStore,
  storedResolutions: Parameters<typeof applyStoredConflictResolutions>[1],
): NoteViewMentions {
  const mentions = extractNoteMentions(markdown, matcher, {
    isEntityViewLinkTarget: (target) =>
      isEntityViewLinkTarget(target, context.settings),
    resolveEntityViewLinkTarget: (target) =>
      resolveEntityViewLinkTarget(target, context.settings, store),
  });
  applyStoredConflictResolutions(mentions.conflicts, storedResolutions);
  return mentions;
}

function renderMarkdownWithMentions(
  markdown: string,
  mentions: NoteViewMentions,
  settings: PluginSettings,
): string {
  return renderNoteView(markdown, mentions, {
    isEntityViewLinkTarget: (target) =>
      isEntityViewLinkTarget(target, settings),
    resolveEntityViewLinkTarget: (target) =>
      resolveEntityViewLinkTarget(target, settings),
    entityLinkTarget: (eid) => entityLinkTargetForEid(settings.entityDir, eid),
  });
}

function isEntityViewLinkTarget(
  target: string,
  settings: Pick<PluginSettings, "entityDir">,
): boolean {
  return entityViewPathFromLinkTarget(target, settings) !== undefined;
}

function resolveEntityViewLinkTarget(
  target: string,
  settings: Pick<PluginSettings, "entityDir">,
  store?: ModelStore,
): string | undefined {
  const viewPath = entityViewPathFromLinkTarget(target, settings);
  if (viewPath === undefined) {
    return undefined;
  }
  const filename = viewPath.split("/").pop() ?? "";
  const eid = filename.endsWith(".md") ? filename.slice(0, -3) : filename;
  if (/^Q[1-9][0-9]*$/.test(eid)) {
    return eid;
  }
  return store?.findEntityEidByViewPath(viewPath);
}

function entityViewPathFromLinkTarget(
  target: string,
  settings: Pick<PluginSettings, "entityDir">,
): string | undefined {
  const normalized = normalizeObsidianLinkTarget(target);
  const entityDir = settings.entityDir;
  const prefix = entityDir ? `${entityDir}/` : "";
  if (!normalized.startsWith(prefix)) {
    return undefined;
  }
  const rest = normalized.slice(prefix.length);
  if (!rest) {
    return undefined;
  }
  return rest.endsWith(".md") ? normalized : `${normalized}.md`;
}

function normalizeObsidianLinkTarget(target: string): string {
  const withoutFragment = target.split(/[#"^]/, 1)[0] ?? "";
  return withoutFragment.trim().replace(/\\/g, "/").replace(/^\/+/g, "");
}

function writeFileAtomically(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tempPath = `${path}.wikipage-spine.tmp`;
  writeFileSync(tempPath, content, "utf8");
  renameSync(tempPath, path);
}
