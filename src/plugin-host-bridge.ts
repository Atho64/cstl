// @module plugin-host-bridge.ts — Host adapter bridging CSTL core to the plugin engine

import type { PluginHostBridge, PluginMeta } from './plugin-types';
import { state, ui, getOpfsRoot } from './state';
import {
  PLUGINS_FILE, PLUGIN_SETTINGS_FILE, PLUGIN_PREFIX,
  savePluginBlob, loadPluginBlob, deletePluginBlob, listPluginBlobs,
  queueAutoSave, loadDashboardProjects
} from './project';
import { flashHint, refreshAll } from './render';
import { onCopyForAi } from './translate';
import { updateCustomImportAccept } from './custom-parser-modal';
import jszipSource from 'jszip/dist/jszip.min.js?raw';

export function createPluginHostBridge(): PluginHostBridge {
  return {
    jszipSource,
    storage: {
      readPluginIndex: async (): Promise<PluginMeta[] | null> => {
        try {
          const root = await getOpfsRoot();
          const fh = await root.getFileHandle(PLUGINS_FILE);
          const f = await fh.getFile();
          const t = await f.text();
          const parsed = JSON.parse(t);
          return Array.isArray(parsed) ? parsed : [];
        } catch {
          return [];
        }
      },
      writePluginIndex: async (items: PluginMeta[]): Promise<void> => {
        const root = await getOpfsRoot();
        const fh = await root.getFileHandle(PLUGINS_FILE, { create: true });
        const w = await fh.createWritable();
        await w.write(JSON.stringify(items));
        await w.close();
      },
      readPluginSettings: async (): Promise<Record<string, any> | null> => {
        try {
          const root = await getOpfsRoot();
          const fh = await root.getFileHandle(PLUGIN_SETTINGS_FILE);
          const f = await fh.getFile();
          const t = await f.text();
          return JSON.parse(t);
        } catch {
          return {};
        }
      },
      writePluginSettings: async (value: Record<string, any>): Promise<void> => {
        const root = await getOpfsRoot();
        const fh = await root.getFileHandle(PLUGIN_SETTINGS_FILE, { create: true });
        const w = await fh.createWritable();
        await w.write(JSON.stringify(value));
        await w.close();
      },
      savePluginZipStream: async (id: string, blob: Blob): Promise<void> => {
        const root = await getOpfsRoot();
        const fh = await root.getFileHandle(PLUGIN_PREFIX + id + '.zip', { create: true });
        const w = await fh.createWritable();
        await w.write(blob);
        await w.close();
      },
      pluginZipFile: async (id: string): Promise<File> => {
        const root = await getOpfsRoot();
        const fh = await root.getFileHandle(PLUGIN_PREFIX + id + '.zip');
        return await fh.getFile();
      },
      pluginZipExists: async (id: string): Promise<boolean> => {
        try {
          const root = await getOpfsRoot();
          await root.getFileHandle(PLUGIN_PREFIX + id + '.zip');
          return true;
        } catch {
          return false;
        }
      },
      listPluginFiles: async (): Promise<Array<{ id: string; name: string }>> => {
        try {
          const root = await getOpfsRoot();
          const out: Array<{ id: string; name: string }> = [];
          for await (const [name, h] of (root as any).entries()) {
            if (h.kind === 'file' && name.startsWith(PLUGIN_PREFIX) && name.endsWith('.zip')) {
              out.push({ id: name.slice(PLUGIN_PREFIX.length, -4), name });
            }
          }
          return out;
        } catch {
          return [];
        }
      },
      removePluginFile: async (id: string): Promise<void> => {
        try {
          const root = await getOpfsRoot();
          await root.removeEntry(PLUGIN_PREFIX + id + '.zip');
        } catch {}
      },
      saveBlob: (pluginId: string, key: string, data: Blob | Uint8Array | ArrayBuffer | string) =>
        savePluginBlob(state.currentProjectId, pluginId, key, data),
      loadBlob: (pluginId: string, key: string) =>
        loadPluginBlob(state.currentProjectId, pluginId, key),
      deleteBlob: (pluginId: string, key: string) =>
        deletePluginBlob(state.currentProjectId, pluginId, key),
      listBlobs: (pluginId: string) =>
        listPluginBlobs(state.currentProjectId, pluginId),
      blobExists: async (pluginId: string, key: string) => {
        const b = await loadPluginBlob(state.currentProjectId, pluginId, key);
        return !!b;
      },
    },
    state: {
      projectId: () => state.currentProjectId,
      projectName: () => state.projectName,
      pluginSettings: () => (state as any).plugin_settings || {},
      setPluginSettings: (v: Record<string, any>) => {
        (state as any).plugin_settings = v;
      },
      queueSave: () => queueAutoSave(),
      projectInfo: () =>
        state.currentProjectId
          ? {
              name: state.projectName,
              type: state.projectType,
              fileCount: state.importedFiles.length,
              lineCount: state.lines.length,
              translatedCount: state.lines.filter((l) => l.is_translated).length,
            }
          : null,
      lines: () => state.lines,
      selection: () => Array.from(state.selectedLines),
      clearSelection: () => {
        state.selectedLines.clear();
        refreshAll();
      },
      selectRangeUI: (from: number, to: number) => {
        if (ui.rangeFromInput) (ui.rangeFromInput as HTMLInputElement).value = String(from);
        if (ui.rangeToInput) (ui.rangeToInput as HTMLInputElement).value = String(to);
        (ui.btnSelectRange as HTMLButtonElement | null)?.click();
      },
      copyForAi: () => {
        onCopyForAi();
      },
    },
    ui: {
      flash: (msg: string, keepAlive?: boolean) => flashHint(msg, keepAlive),
      onPluginsChanged: () => {
        (window as any).CSTL?.plugins?.renderPluginMenu?.();
        try {
          updateCustomImportAccept();
        } catch (_) {}
      },
      loadDashboard: () => {
        loadDashboardProjects();
      },
      closeDropdowns: () => {
        document.querySelectorAll('.dropdown-content.show').forEach((el) => el.classList.remove('show'));
        document.querySelectorAll('.dropdown-toggle[aria-expanded="true"]').forEach((el) => el.setAttribute('aria-expanded', 'false'));
      },
    },
  };
}
