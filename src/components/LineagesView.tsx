import React, { useState } from 'react';
import {
  Check,
  FolderPlus,
  GitFork,
  Import,
  Pencil,
  Trash2,
} from 'lucide-react';
import { SEED_FAMILY_TREES } from '../data/seedFamilyTrees';
import type { FamilyTreeRecord } from '../types/family';

interface LineagesViewProps {
  trees: FamilyTreeRecord[];
  activeTreeId: string;
  isCloudMode: boolean;
  onSelectTree: (treeId: string) => void;
  onCreateTree: (name: string, description: string) => Promise<string>;
  onRenameTree: (treeId: string, name: string, description: string) => Promise<void>;
  onDeleteTree: (treeId: string) => Promise<void>;
  onImportTemplate: (templateId: string) => Promise<string | null>;
}

export function LineagesView({
  trees,
  activeTreeId,
  isCloudMode,
  onSelectTree,
  onCreateTree,
  onRenameTree,
  onDeleteTree,
  onImportTemplate,
}: LineagesViewProps) {
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [creating, setCreating] = useState(false);
  const [importingId, setImportingId] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    try {
      await onCreateTree(newName, newDesc);
      setNewName('');
      setNewDesc('');
    } finally {
      setCreating(false);
    }
  };

  const handleSaveRename = async (treeId: string) => {
    if (!editName.trim()) return;
    await onRenameTree(treeId, editName, editDesc);
    setEditingId(null);
  };

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 space-y-8">
        <div>
          <h1 className="font-display text-2xl font-semibold text-slate-900 tracking-tight">
            Family Lineages
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Switch between saved family trees, start a blank lineage, or re-import diagrams from
            your attached family tree PDF.
          </p>
        </div>

        {/* Saved Trees */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Your Saved Trees ({trees.length})
            </h2>
            <span className="text-xs text-slate-500">
              {isCloudMode ? 'Synced to Cloud Firestore' : 'Stored locally in this browser'}
            </span>
          </div>

          <div className="divide-y divide-slate-200 bg-white border border-slate-200 rounded-2xl overflow-hidden">
            {trees.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-500">
                No family trees yet. Create one below or import an attached lineage.
              </div>
            ) : (
              trees.map((tree) => {
                const isActive = tree.id === activeTreeId;
                const isEditing = editingId === tree.id;
                const isDeleting = confirmDeleteId === tree.id;

                return (
                  <div
                    key={tree.id}
                    className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                  >
                    {isEditing ? (
                      <div className="flex-1 space-y-2">
                        <input
                          type="text"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          maxLength={120}
                          className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-lg"
                        />
                        <input
                          type="text"
                          value={editDesc}
                          onChange={(e) => setEditDesc(e.target.value)}
                          maxLength={400}
                          placeholder="Short description..."
                          className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg"
                        />
                        <div className="flex items-center gap-2 pt-1">
                          <button
                            type="button"
                            onClick={() => void handleSaveRename(tree.id)}
                            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-slate-900 text-white rounded-lg hover:bg-slate-800"
                          >
                            <Check className="w-3.5 h-3.5" aria-hidden="true" />
                            Save
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingId(null)}
                            className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <h3 className="font-display text-base font-semibold text-slate-900 truncate">
                            {tree.name}
                          </h3>
                          {isActive && (
                            <span className="text-xs font-medium text-blue-700">· Active</span>
                          )}
                        </div>
                        {tree.description && (
                          <p className="text-xs text-slate-500 mt-1">{tree.description}</p>
                        )}
                        <p className="text-[11px] font-mono tabular-nums text-slate-400 mt-1.5">
                          Updated {new Date(tree.updatedAt).toLocaleDateString()}
                        </p>
                      </div>
                    )}

                    {!isEditing && (
                      <div className="flex items-center gap-2 shrink-0">
                        {isDeleting ? (
                          <>
                            <span className="text-xs text-rose-700 font-medium mr-1">
                              Delete tree?
                            </span>
                            <button
                              type="button"
                              onClick={async () => {
                                await onDeleteTree(tree.id);
                                setConfirmDeleteId(null);
                              }}
                              className="px-3 py-1.5 text-xs font-medium text-white bg-rose-600 rounded-lg hover:bg-rose-700"
                            >
                              Confirm
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(null)}
                              className="px-3 py-1.5 text-xs font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50"
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => onSelectTree(tree.id)}
                              className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
                                isActive
                                  ? 'bg-slate-100 text-slate-900'
                                  : 'bg-slate-900 text-white hover:bg-slate-800'
                              }`}
                            >
                              <GitFork className="w-3.5 h-3.5" aria-hidden="true" />
                              {isActive ? 'Open Canvas' : 'Switch to Tree'}
                            </button>
                            <button
                              type="button"
                              title="Rename Tree"
                              aria-label={`Rename ${tree.name}`}
                              onClick={() => {
                                setEditingId(tree.id);
                                setEditName(tree.name);
                                setEditDesc(tree.description);
                              }}
                              className="p-2 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors"
                            >
                              <Pencil className="w-4 h-4" aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              title="Delete Tree"
                              aria-label={`Delete ${tree.name}`}
                              onClick={() => setConfirmDeleteId(tree.id)}
                              className="p-2 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                            >
                              <Trash2 className="w-4 h-4" aria-hidden="true" />
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </section>

        {/* Create Blank Tree */}
        <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <form
            onSubmit={handleCreate}
            className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4"
          >
            <div className="flex items-center gap-2.5">
              <FolderPlus className="w-5 h-5 text-slate-700" aria-hidden="true" />
              <h2 className="font-display text-base font-semibold text-slate-900">
                Create Blank Family Tree
              </h2>
            </div>
            <p className="text-xs text-slate-500">
              Start a clean workspace to map a new branch or side of the family from scratch.
            </p>
            <div className="space-y-3">
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                maxLength={120}
                required
                placeholder="Tree name (e.g., Maternal Lineage)"
                className="w-full px-3.5 py-2 text-sm border border-slate-200 rounded-lg focus:border-slate-900"
              />
              <input
                type="text"
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                maxLength={400}
                placeholder="Optional description..."
                className="w-full px-3.5 py-2 text-sm border border-slate-200 rounded-lg focus:border-slate-900"
              />
            </div>
            <button
              type="submit"
              disabled={creating || !newName.trim()}
              className="px-4 py-2 text-xs font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors disabled:opacity-50"
            >
              {creating ? 'Creating...' : 'Create Blank Tree'}
            </button>
          </form>

          {/* Re-import Attached PDF Lineages */}
          <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
            <div className="flex items-center gap-2.5">
              <Import className="w-5 h-5 text-slate-700" aria-hidden="true" />
              <h2 className="font-display text-base font-semibold text-slate-900">
                Attached Diagram Templates
              </h2>
            </div>
            <p className="text-xs text-slate-500">
              Create a fresh copy from the lineages extracted from your attached{' '}
              <span className="font-mono">familytree.drawio.pdf</span>.
            </p>
            <div className="space-y-3">
              {SEED_FAMILY_TREES.map((seed) => (
                <div
                  key={seed.id}
                  className="flex items-center justify-between gap-3 py-2.5 border-t border-slate-100 first:border-t-0"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-900 truncate">{seed.name}</p>
                    <p className="text-xs text-slate-500 font-mono tabular-nums">
                      {seed.members.length} members · {seed.relationships.length} links
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={importingId !== null}
                    onClick={async () => {
                      setImportingId(seed.id);
                      try {
                        await onImportTemplate(seed.id);
                      } finally {
                        setImportingId(null);
                      }
                    }}
                    className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
                  >
                    {importingId === seed.id ? 'Importing...' : 'Import Copy'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
