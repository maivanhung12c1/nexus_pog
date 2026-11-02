// Editor UI state (transient, never saved with the project).
import { create } from 'zustand';
import type { BuildParams } from '../domain/ops/edit';
import type { ViewMode } from '../render/viewport';

export type LibTab = 'products' | 'fixtures' | 'posm';
export type InspectorTab = 'properties' | 'layers' | 'quantities';

interface EditorState {
  view: ViewMode;
  measure: boolean;
  builder: (BuildParams & { srcId: string; mode: 'row' | 'grid' | 'block' }) | null;
  libTab: LibTab;
  inspector: InspectorTab;
  libQuery: string;
  libForm: 'all' | 'carton' | 'pack' | 'unit' | 'used';
  libBrand: string;
  libLimit: number;
  warningsOpen: boolean;
  dialog: null | { kind: string; data?: unknown };
}

export const useEditor = create<EditorState>(() => ({
  view: 'split', measure: false, builder: null, libTab: 'products', inspector: 'properties', libQuery: '', libForm: 'all', libBrand: '', libLimit: 120, warningsOpen: false, dialog: null,
}));
export const editor = { set: (p: Partial<EditorState>) => useEditor.setState(p), get: () => useEditor.getState() };
