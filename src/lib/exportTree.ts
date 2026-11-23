import { jsPDF } from 'jspdf';
import type { TreeLayoutResult } from '../types/family';
import { getEffectiveAge, getInitials } from './familyUtils';
import { sanitizeImageUrl } from './security';

function loadImage(src: string): Promise<HTMLImageElement | null> {
  const safeSrc = sanitizeImageUrl(src);
  if (!safeSrc) return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.referrerPolicy = 'no-referrer';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = safeSrc;
  });
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function truncateText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let out = text;
  while (out.length > 1 && ctx.measureText(out + '…').width > maxWidth) {
    out = out.slice(0, -1);
  }
  return out + '…';
}

/**
 * Renders the complete family tree layout to a crisp bounded PNG canvas
 * safely handling arbitrarily wide multi-generation trees without DOM overflow.
 */
async function renderTreeToCanvas(
  layout: TreeLayoutResult,
  treeName: string
): Promise<HTMLCanvasElement> {
  const padding = 64;
  const headerH = 56;
  const contentW = Math.max(layout.bounds.width, 600);
  const contentH = Math.max(layout.bounds.height, 400);

  const rawW = contentW + padding * 2;
  const rawH = contentH + padding * 2 + headerH;

  // Keep canvas within safe browser maximums (<= 8192px) while maximizing sharpness
  const maxDim = 8000;
  const desiredScale = 2;
  const scale = Math.min(desiredScale, maxDim / rawW, maxDim / rawH);

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(rawW * scale));
  canvas.height = Math.max(1, Math.round(rawH * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas context unavailable for export.');

  ctx.scale(scale, scale);

  // Clean off-white background
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(0, 0, rawW, rawH);

  // Header title
  ctx.fillStyle = '#0f172a';
  ctx.font = '700 24px "Plus Jakarta Sans", system-ui, sans-serif';
  ctx.fillText(treeName || 'Family Tree', padding, 42);

  ctx.fillStyle = '#64748b';
  ctx.font = '500 13px "Plus Jakarta Sans", system-ui, sans-serif';
  ctx.fillText(
    `${layout.nodes.length} members · ${layout.generations.length} generations · Exported ${new Date().toLocaleDateString()}`,
    padding,
    64
  );

  const offsetX = padding - layout.bounds.minX;
  const offsetY = padding + headerH - layout.bounds.minY;

  ctx.save();
  ctx.translate(offsetX, offsetY);

  // Draw connectors first
  for (const conn of layout.connectors) {
    ctx.save();
    ctx.beginPath();
    const path2d = new Path2D(conn.path);
    if (conn.type === 'spouse') {
      ctx.strokeStyle = '#64748b';
      ctx.lineWidth = 2;
    } else if (conn.type === 'parent_child') {
      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = 1.75;
    } else {
      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 4]);
    }
    ctx.stroke(path2d);

    if (conn.unionPoint) {
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#475569';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(conn.unionPoint.x, conn.unionPoint.y, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  // Preload photos in parallel
  const loadedPhotos = await Promise.all(
    layout.nodes.map((n) => loadImage(n.member.photoUrl))
  );

  // Draw member cards
  layout.nodes.forEach((node, idx) => {
    const { member, x, y, width, height } = node;
    const isMale = member.gender === 'male';
    const accentColor = isMale ? '#2563eb' : '#db2777';
    const tintBg = isMale ? '#eff6ff' : '#fdf2f8';
    const tintText = isMale ? '#1d4ed8' : '#be185d';

    // Card surface
    ctx.save();
    drawRoundedRect(ctx, x, y, width, height, 10);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Top 3px gender accent strip clipped to card rounded top
    ctx.save();
    drawRoundedRect(ctx, x, y, width, height, 10);
    ctx.clip();
    ctx.fillStyle = accentColor;
    ctx.fillRect(x, y, width, 3);
    ctx.restore();

    // Avatar circle
    const avatarX = x + 14;
    const avatarY = y + 20;
    const avatarR = 22;
    const img = loadedPhotos[idx];

    ctx.save();
    ctx.beginPath();
    ctx.arc(avatarX + avatarR, avatarY + avatarR, avatarR, 0, Math.PI * 2);
    ctx.closePath();
    ctx.fillStyle = tintBg;
    ctx.fill();
    if (img) {
      ctx.clip();
      ctx.drawImage(img, avatarX, avatarY, avatarR * 2, avatarR * 2);
    } else {
      ctx.fillStyle = tintText;
      ctx.font = '600 14px "Plus Jakarta Sans", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(getInitials(member.fullName), avatarX + avatarR, avatarY + avatarR + 0.5);
    }
    ctx.restore();

    // Text block
    const textX = avatarX + avatarR * 2 + 12;
    const maxTextW = width - (textX - x) - 12;

    ctx.fillStyle = '#0f172a';
    ctx.font = '600 13.5px "Plus Jakarta Sans", system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(truncateText(ctx, member.fullName, maxTextW), textX, y + 36);

    const { age } = getEffectiveAge(member);
    const metaParts = [isMale ? 'Male' : 'Female'];
    if (age !== null) metaParts.push(`${age} yrs`);
    ctx.fillStyle = tintText;
    ctx.font = '500 11.5px "Plus Jakarta Sans", system-ui, sans-serif';
    ctx.fillText(truncateText(ctx, metaParts.join(' · '), maxTextW), textX, y + 55);

    if (member.address) {
      ctx.fillStyle = '#64748b';
      ctx.font = '400 11px "Plus Jakarta Sans", system-ui, sans-serif';
      ctx.fillText(truncateText(ctx, member.address, maxTextW), textX, y + 74);
    }

    ctx.restore();
  });

  ctx.restore();
  return canvas;
}

export async function exportTreeAsPng(
  layout: TreeLayoutResult,
  treeName: string
): Promise<void> {
  const canvas = await renderTreeToCanvas(layout, treeName);
  const url = canvas.toDataURL('image/png');
  const link = document.createElement('a');
  const safeName = (treeName || 'family-tree')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  link.download = `${safeName || 'family-tree'}.png`;
  link.href = url;
  link.click();
}

export async function exportTreeAsPdf(
  layout: TreeLayoutResult,
  treeName: string
): Promise<void> {
  const canvas = await renderTreeToCanvas(layout, treeName);
  const imgData = canvas.toDataURL('image/png');
  const orientation = canvas.width >= canvas.height ? 'landscape' : 'portrait';
  const pdf = new jsPDF({
    orientation,
    unit: 'px',
    format: [Math.max(canvas.width / 2, 600), Math.max(canvas.height / 2, 420)],
  });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  pdf.addImage(imgData, 'PNG', 0, 0, pageW, pageH, undefined, 'FAST');

  const safeName = (treeName || 'family-tree')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  pdf.save(`${safeName || 'family-tree'}.pdf`);
}
