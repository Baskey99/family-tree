import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Download,
  Expand,
  FileImage,
  FileText,
  Maximize2,
  Minimize2,
  RotateCcw,
  Shrink,
  UnfoldVertical,
  UserPlus,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { TreeLayoutResult } from '../types/family';
import { exportTreeAsPdf, exportTreeAsPng } from '../lib/exportTree';
import { MemberCard } from './MemberCard';

export interface FamilyTreeCanvasHandle {
  focusMember: (memberId: string) => void;
  fitToView: () => void;
  resetView: () => void;
}

interface FamilyTreeCanvasProps {
  treeName: string;
  layout: TreeLayoutResult;
  selectedMemberId: string | null;
  highlightedMemberId: string | null;
  hasCollapsedBranches: boolean;
  onSelectMember: (memberId: string | null) => void;
  onViewDetails: (memberId: string) => void;
  onEditMember: (memberId: string) => void;
  onAddRelative: (memberId: string) => void;
  onDeleteMember: (memberId: string) => void;
  onToggleCollapse: (memberId: string) => void;
  onExpandAll: () => void;
  onResetLayout: () => void;
  onAddFirstMember: () => void;
  onNotify: (msg: string, isError?: boolean) => void;
}

const MIN_SCALE = 0.14;
const MAX_SCALE = 2.0;

export const FamilyTreeCanvas = forwardRef<FamilyTreeCanvasHandle, FamilyTreeCanvasProps>(
  function FamilyTreeCanvas(
    {
      treeName,
      layout,
      selectedMemberId,
      highlightedMemberId,
      hasCollapsedBranches,
      onSelectMember,
      onViewDetails,
      onEditMember,
      onAddRelative,
      onDeleteMember,
      onToggleCollapse,
      onExpandAll,
      onResetLayout,
      onAddFirstMember,
      onNotify,
    },
    ref
  ) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const [transform, setTransform] = useState({ x: 40, y: 40, scale: 0.85 });
    const [isPanning, setIsPanning] = useState(false);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [exportMenuOpen, setExportMenuOpen] = useState(false);
    const [isExporting, setIsExporting] = useState(false);

    const dragStateRef = useRef<{
      active: boolean;
      startX: number;
      startY: number;
      originX: number;
      originY: number;
      moved: boolean;
    }>({
      active: false,
      startX: 0,
      startY: 0,
      originX: 0,
      originY: 0,
      moved: false,
    });

    // Active pointers map for mobile pinch-to-zoom
    const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
    const pinchRef = useRef<{ dist: number; scale: number; midX: number; midY: number } | null>(
      null
    );

    const fitToView = useCallback(() => {
      const container = containerRef.current;
      if (!container || layout.nodes.length === 0) return;

      const rect = container.getBoundingClientRect();
      const { minX, minY, width, height } = layout.bounds;
      if (width <= 0 || height <= 0) return;

      const pad = 48;
      const availW = Math.max(rect.width - pad * 2, 200);
      const availH = Math.max(rect.height - pad * 2, 200);

      const fitScale = Math.max(
        MIN_SCALE,
        Math.min(1.0, Math.min(availW / width, availH / height))
      );

      // If tree is very wide (e.g. 190 members), fit cleanly without making cards microscopic
      const displayScale = layout.nodes.length > 60 ? Math.max(fitScale, 0.28) : fitScale;

      const centerX = minX + width / 2;
      const topY = minY;
      const tx = rect.width / 2 - centerX * displayScale;
      const ty =
        height * displayScale < rect.height - 80
          ? rect.height / 2 - (minY + height / 2) * displayScale
          : 44 - topY * displayScale;

      setTransform({ x: tx, y: ty, scale: displayScale });
    }, [layout]);

    const focusMember = useCallback(
      (memberId: string) => {
        const container = containerRef.current;
        const node = layout.nodes.find((n) => n.member.id === memberId);
        if (!container || !node) return;
        const rect = container.getBoundingClientRect();
        const targetScale = Math.max(transform.scale, 0.92);
        const clampedScale = Math.min(1.15, targetScale);
        const nodeCenterX = node.x + node.width / 2;
        const nodeCenterY = node.y + node.height / 2;

        setTransform({
          x: rect.width / 2 - nodeCenterX * clampedScale,
          y: rect.height / 2 - nodeCenterY * clampedScale,
          scale: clampedScale,
        });
      },
      [layout.nodes, transform.scale]
    );

    const resetView = useCallback(() => {
      onResetLayout();
      window.setTimeout(() => {
        fitToView();
      }, 30);
    }, [onResetLayout, fitToView]);

    useImperativeHandle(
      ref,
      () => ({
        focusMember,
        fitToView,
        resetView,
      }),
      [focusMember, fitToView, resetView]
    );

    // Auto-fit when switching to a different tree or loading initial nodes
    const lastNodeCountKeyRef = useRef<string>('');
    useEffect(() => {
      const key = `${treeName}:${layout.nodes.length > 0 ? layout.nodes[0].member.treeId : 'empty'}`;
      if (layout.nodes.length > 0 && lastNodeCountKeyRef.current !== key) {
        lastNodeCountKeyRef.current = key;
        const id = window.requestAnimationFrame(() => fitToView());
        return () => window.cancelAnimationFrame(id);
      }
    }, [treeName, layout.nodes, fitToView]);

    // Sync fullscreen state with browser
    useEffect(() => {
      const onFsChange = () => {
        setIsFullscreen(Boolean(document.fullscreenElement));
      };
      document.addEventListener('fullscreenchange', onFsChange);
      return () => document.removeEventListener('fullscreenchange', onFsChange);
    }, []);

    const toggleFullscreen = async () => {
      const el = containerRef.current;
      if (!el) return;
      try {
        if (!document.fullscreenElement) {
          await el.requestFullscreen();
        } else {
          await document.exitFullscreen();
        }
      } catch {
        // Fallback fullscreen state if iframe disallows native Fullscreen API
        setIsFullscreen((prev) => !prev);
      }
    };

    const zoomBy = useCallback((factor: number, clientX?: number, clientY?: number) => {
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const px = clientX !== undefined ? clientX - rect.left : rect.width / 2;
      const py = clientY !== undefined ? clientY - rect.top : rect.height / 2;

      setTransform((prev) => {
        const nextScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, prev.scale * factor));
        const ratio = nextScale / prev.scale;
        return {
          scale: nextScale,
          x: px - (px - prev.x) * ratio,
          y: py - (py - prev.y) * ratio,
        };
      });
    }, []);

    // Wheel zoom toward cursor
    useEffect(() => {
      const el = containerRef.current;
      if (!el) return;
      const onWheel = (e: WheelEvent) => {
        e.preventDefault();
        if (e.ctrlKey || e.metaKey || Math.abs(e.deltaY) > 0) {
          const factor = e.deltaY < 0 ? 1.1 : 0.91;
          zoomBy(factor, e.clientX, e.clientY);
        }
      };
      el.addEventListener('wheel', onWheel, { passive: false });
      return () => el.removeEventListener('wheel', onWheel);
    }, [zoomBy]);

    // Pointer pan + mobile two-finger pinch zoom
    const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      setExportMenuOpen(false);
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (pointersRef.current.size === 2) {
        const pts = [...pointersRef.current.values()];
        const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
        pinchRef.current = {
          dist,
          scale: transform.scale,
          midX: (pts[0].x + pts[1].x) / 2,
          midY: (pts[0].y + pts[1].y) / 2,
        };
        dragStateRef.current.active = false;
        return;
      }

      dragStateRef.current = {
        active: true,
        startX: e.clientX,
        startY: e.clientY,
        originX: transform.x,
        originY: transform.y,
        moved: false,
      };
      setIsPanning(true);
      (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    };

    const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
      if (pointersRef.current.has(e.pointerId)) {
        pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      }

      if (pointersRef.current.size === 2 && pinchRef.current) {
        const pts = [...pointersRef.current.values()];
        const newDist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
        if (pinchRef.current.dist > 0) {
          const factor = newDist / pinchRef.current.dist;
          const nextScale = Math.max(
            MIN_SCALE,
            Math.min(MAX_SCALE, pinchRef.current.scale * factor)
          );
          const container = containerRef.current;
          if (container) {
            const rect = container.getBoundingClientRect();
            const px = pinchRef.current.midX - rect.left;
            const py = pinchRef.current.midY - rect.top;
            setTransform((prev) => {
              const ratio = nextScale / prev.scale;
              return {
                scale: nextScale,
                x: px - (px - prev.x) * ratio,
                y: py - (py - prev.y) * ratio,
              };
            });
          }
        }
        return;
      }

      if (!dragStateRef.current.active) return;
      const dx = e.clientX - dragStateRef.current.startX;
      const dy = e.clientY - dragStateRef.current.startY;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
        dragStateRef.current.moved = true;
      }
      setTransform((prev) => ({
        ...prev,
        x: dragStateRef.current.originX + dx,
        y: dragStateRef.current.originY + dy,
      }));
    };

    const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
      pointersRef.current.delete(e.pointerId);
      if (pointersRef.current.size < 2) pinchRef.current = null;
      if (dragStateRef.current.active) {
        const wasMoved = dragStateRef.current.moved;
        dragStateRef.current.active = false;
        setIsPanning(false);
        if (!wasMoved) {
          onSelectMember(null);
        }
      }
    };

    const handleExport = async (format: 'png' | 'pdf') => {
      setExportMenuOpen(false);
      if (layout.nodes.length === 0) return;
      setIsExporting(true);
      try {
        if (format === 'png') {
          await exportTreeAsPng(layout, treeName);
          onNotify('Exported family tree as PNG image');
        } else {
          await exportTreeAsPdf(layout, treeName);
          onNotify('Exported family tree as PDF document');
        }
      } catch (err) {
        onNotify(
          err instanceof Error ? err.message : `Failed to export as ${format.toUpperCase()}.`,
          true
        );
      } finally {
        setIsExporting(false);
      }
    };

    const connectedToSelected = useMemo(() => {
      const set = new Set<string>();
      if (!selectedMemberId) return set;
      set.add(selectedMemberId);
      for (const conn of layout.connectors) {
        if (conn.involvedMemberIds.includes(selectedMemberId)) {
          for (const id of conn.involvedMemberIds) set.add(id);
        }
      }
      return set;
    }, [selectedMemberId, layout.connectors]);

    // Empty state
    if (layout.nodes.length === 0) {
      return (
        <div
          ref={containerRef}
          className="relative flex-1 w-full h-full canvas-dot-grid flex items-center justify-center p-6"
        >
          <div className="max-w-md w-full bg-white border border-slate-200 rounded-2xl p-8 text-center shadow-xs space-y-5">
            <div className="mx-auto w-14 h-14 rounded-2xl bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-700">
              <UserPlus className="w-6 h-6" aria-hidden="true" />
            </div>
            <div className="space-y-2">
              <h2 className="font-display text-xl font-semibold text-slate-900">
                Start your family tree
              </h2>
              <p className="text-sm text-slate-600 leading-relaxed">
                Add your first family member to begin mapping generations. Parents, spouses,
                children, siblings, and cousins will automatically arrange themselves as you grow
                the tree.
              </p>
            </div>
            <button
              type="button"
              onClick={onAddFirstMember}
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-medium bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors"
            >
              <UserPlus className="w-4 h-4" aria-hidden="true" />
              Add Family Member
            </button>
          </div>
        </div>
      );
    }

    const svgWidth = Math.max(layout.bounds.maxX + 400, 2000);
    const svgHeight = Math.max(layout.bounds.maxY + 400, 1400);

    return (
      <div
        ref={containerRef}
        className={`relative flex-1 w-full h-full overflow-hidden canvas-dot-grid touch-none ${
          isFullscreen ? 'fixed inset-0 z-50' : ''
        } ${isPanning ? 'cursor-grabbing' : 'cursor-grab'}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        aria-label="Interactive family tree canvas"
      >
        {/* Left Generation Rail (synced vertically with pan & zoom) */}
        <div
          className="pointer-events-none absolute top-0 left-0 bottom-0 z-10 w-24 hidden sm:block"
          aria-hidden="true"
        >
          {layout.generations.map((g) => {
            const screenY = g.y * transform.scale + transform.y + (54 * transform.scale);
            if (screenY < -40 || screenY > 2400) return null;
            return (
              <div
                key={g.generation}
                style={{ transform: `translate3d(12px, ${screenY - 12}px, 0)` }}
                className="absolute top-0 left-0 flex flex-col"
              >
                <span className="text-[11px] font-mono tabular-nums font-medium text-slate-500 bg-slate-50/90 backdrop-blur-[2px] px-1.5 py-0.5 rounded border border-slate-200/80">
                  {g.label}
                </span>
              </div>
            );
          })}
        </div>

        {/* Transformed Infinite Viewport */}
        <div
          style={{
            transform: `translate3d(${transform.x}px, ${transform.y}px, 0) scale(${transform.scale})`,
            transformOrigin: '0 0',
          }}
          className="absolute top-0 left-0 will-change-transform"
        >
          {/* Orthogonal Relationship Connectors SVG Layer */}
          <svg
            width={svgWidth}
            height={svgHeight}
            className="absolute top-0 left-0 pointer-events-none overflow-visible"
            aria-hidden="true"
          >
            {layout.connectors.map((conn) => {
              const isRelated =
                selectedMemberId !== null &&
                conn.involvedMemberIds.includes(selectedMemberId);

              const strokeColor = isRelated
                ? '#0f172a'
                : conn.type === 'spouse'
                  ? '#64748b'
                  : '#94a3b8';

              const strokeWidth = isRelated ? 2.4 : conn.type === 'spouse' ? 2 : 1.75;
              const isDashed =
                conn.type === 'sibling' || conn.type === 'cousin' || conn.type === 'other';

              return (
                <g key={conn.id}>
                  <path
                    d={conn.path}
                    fill="none"
                    stroke={strokeColor}
                    strokeWidth={strokeWidth}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeDasharray={isDashed ? '5 4' : undefined}
                  />
                  {conn.unionPoint && (
                    <circle
                      cx={conn.unionPoint.x}
                      cy={conn.unionPoint.y}
                      r={4.5}
                      fill="#ffffff"
                      stroke={strokeColor}
                      strokeWidth={2}
                    />
                  )}
                  {conn.label && conn.labelPos && (
                    <text
                      x={conn.labelPos.x}
                      y={conn.labelPos.y}
                      textAnchor="middle"
                      fill="#64748b"
                      fontSize="11"
                      fontWeight="500"
                    >
                      {conn.label}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>

          {/* Profile Cards Layer */}
          <div className="relative">
            {layout.nodes.map((node) => (
              <MemberCard
                key={node.member.id}
                node={node}
                isSelected={selectedMemberId === node.member.id}
                isHighlighted={highlightedMemberId === node.member.id}
                isDimmed={
                  selectedMemberId !== null &&
                  !connectedToSelected.has(node.member.id) &&
                  highlightedMemberId !== node.member.id
                }
                onSelect={(id) => onSelectMember(id)}
                onViewDetails={onViewDetails}
                onEdit={onEditMember}
                onAddRelative={onAddRelative}
                onDelete={onDeleteMember}
                onToggleCollapse={onToggleCollapse}
              />
            ))}
          </div>
        </div>

        {/* Bottom-Center Floating Canvas Toolbar */}
        <div
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          className="absolute bottom-5 left-1/2 -translate-x-1/2 z-20 max-w-[calc(100vw-24px)]"
        >
          <div className="flex items-center gap-1 bg-white/95 backdrop-blur-sm border border-slate-200 rounded-xl p-1.5 shadow-md">
            <button
              type="button"
              onClick={() => zoomBy(0.84)}
              title="Zoom Out"
              aria-label="Zoom out"
              className="p-2 rounded-lg text-slate-700 hover:bg-slate-100 transition-colors"
            >
              <ZoomOut className="w-4 h-4" aria-hidden="true" />
            </button>

            <span className="px-2 text-xs font-mono tabular-nums font-medium text-slate-700 min-w-[46px] text-center select-none">
              {Math.round(transform.scale * 100)}%
            </span>

            <button
              type="button"
              onClick={() => zoomBy(1.18)}
              title="Zoom In"
              aria-label="Zoom in"
              className="p-2 rounded-lg text-slate-700 hover:bg-slate-100 transition-colors"
            >
              <ZoomIn className="w-4 h-4" aria-hidden="true" />
            </button>

            <div className="w-px h-5 bg-slate-200 mx-1" aria-hidden="true" />

            <button
              type="button"
              onClick={fitToView}
              title="Fit Entire Tree"
              aria-label="Fit entire tree to view"
              className="inline-flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-xs font-medium text-slate-700 hover:bg-slate-100 transition-colors whitespace-nowrap shrink-0"
            >
              <Shrink className="w-4 h-4" aria-hidden="true" />
              <span className="hidden md:inline">Fit Tree</span>
            </button>

            <button
              type="button"
              onClick={resetView}
              title="Reset Layout"
              aria-label="Reset tree layout and view"
              className="inline-flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-xs font-medium text-slate-700 hover:bg-slate-100 transition-colors whitespace-nowrap shrink-0"
            >
              <RotateCcw className="w-4 h-4" aria-hidden="true" />
              <span className="hidden md:inline">Reset</span>
            </button>

            {hasCollapsedBranches && (
              <button
                type="button"
                onClick={onExpandAll}
                title="Expand All Branches"
                aria-label="Expand all collapsed branches"
                className="inline-flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 transition-colors whitespace-nowrap shrink-0"
              >
                <UnfoldVertical className="w-4 h-4" aria-hidden="true" />
                <span className="hidden sm:inline">Expand All</span>
              </button>
            )}

            <div className="w-px h-5 bg-slate-200 mx-1" aria-hidden="true" />

            <button
              type="button"
              onClick={toggleFullscreen}
              title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
              aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
              className="p-2 rounded-lg text-slate-700 hover:bg-slate-100 transition-colors"
            >
              {isFullscreen ? (
                <Minimize2 className="w-4 h-4" aria-hidden="true" />
              ) : (
                <Maximize2 className="w-4 h-4" aria-hidden="true" />
              )}
            </button>

            {/* Export Menu */}
            <div className="relative">
              <button
                type="button"
                disabled={isExporting}
                onClick={() => setExportMenuOpen((o) => !o)}
                title="Export Family Tree"
                aria-label="Export family tree"
                aria-expanded={exportMenuOpen}
                className="inline-flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-xs font-medium text-slate-700 hover:bg-slate-100 transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
              >
                <Download className="w-4 h-4" aria-hidden="true" />
                <span className="hidden sm:inline">
                  {isExporting ? 'Exporting...' : 'Export'}
                </span>
              </button>

              {exportMenuOpen && (
                <div className="absolute bottom-12 right-0 w-48 bg-white border border-slate-200 rounded-xl shadow-lg py-1.5 z-30">
                  <button
                    type="button"
                    onClick={() => void handleExport('png')}
                    className="w-full px-3.5 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-50 flex items-center gap-2.5"
                  >
                    <FileImage className="w-4 h-4 text-slate-500" aria-hidden="true" />
                    Export as PNG Image
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleExport('pdf')}
                    className="w-full px-3.5 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-50 flex items-center gap-2.5"
                  >
                    <FileText className="w-4 h-4 text-slate-500" aria-hidden="true" />
                    Export as PDF Document
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Subtle orientation legend (bottom-left on desktop) */}
        <div
          className="pointer-events-none hidden lg:flex items-center gap-4 absolute bottom-5 left-5 z-10 text-[11px] text-slate-500 bg-white/85 backdrop-blur-xs border border-slate-200/80 rounded-lg px-3 py-1.5"
          aria-hidden="true"
        >
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-0.5 bg-blue-600 inline-block" />
            Male
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-0.5 bg-pink-600 inline-block" />
            Female
          </span>
          <span className="text-slate-300">·</span>
          <span className="inline-flex items-center gap-1">
            <Expand className="w-3 h-3" />
            Drag to pan · Scroll to zoom
          </span>
        </div>
      </div>
    );
  }
);
