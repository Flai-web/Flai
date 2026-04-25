import React, { useState, useRef } from 'react';
import { Upload, X, Youtube, Images, Crop } from 'lucide-react';
import { supabase } from '../utils/supabase';
import toast from 'react-hot-toast';
import EditableContent from './EditableContent';

interface ImageUploadProps {
  onImageUploaded: (url: string, isYoutube?: boolean) => void;
  onMultipleUploaded?: (urls: string[]) => void;
  currentImageUrl?: string | null;
  bucket?: string;
  allowMultiple?: boolean;
  /** Optional: pre-fill the custom filename input */
  defaultCustomName?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtBytes(bytes: number): string {
  if (bytes < 1024)        return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ─── Autocrop ─────────────────────────────────────────────────────────────────
// Trims rows/columns that are "background" — either fully transparent, or
// matching the colour sampled from the 4 corner pixels (±30 per channel).
// This handles white backgrounds, blue backgrounds, any solid colour.
// Runs entirely in the browser via canvas — no server round-trip.
// Returns the original File unchanged if:
//   - the file is a video / GIF / SVG (pass-through types)
//   - nothing needs trimming
//   - anything goes wrong (errors are always non-fatal)

const AUTOCROP_TOLERANCE = 30; // per-channel tolerance for background matching

async function autocropFile(file: File, freeAspect: boolean): Promise<File> {
  if (
    !file.type.startsWith('image/') ||
    file.type === 'image/gif'       ||
    file.type === 'image/svg+xml'
  ) {
    return file;
  }

  return new Promise<File>((resolve) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      try {
        const canvas  = document.createElement('canvas');
        canvas.width  = img.naturalWidth;
        canvas.height = img.naturalHeight;

        if (canvas.width === 0 || canvas.height === 0) { resolve(file); return; }

        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0);

        const { width, height } = canvas;
        const data = ctx.getImageData(0, 0, width, height).data;

        // ── Detect background colour from the 4 corner pixels ──────────────
        // If any corner is transparent we rely purely on alpha.
        // Otherwise we average the corner colours and use that as the bg.
        type Bg = { r: number; g: number; b: number } | null;
        const corners = [
          [0, 0], [width - 1, 0], [0, height - 1], [width - 1, height - 1],
        ].map(([x, y]) => {
          const i = (y * width + x) * 4;
          return { r: data[i], g: data[i + 1], b: data[i + 2], a: data[i + 3] };
        });

        const bg: Bg = corners.some(c => c.a < 10)
          ? null // transparent corners — alpha-only mode
          : {
              r: Math.round(corners.reduce((s, c) => s + c.r, 0) / 4),
              g: Math.round(corners.reduce((s, c) => s + c.g, 0) / 4),
              b: Math.round(corners.reduce((s, c) => s + c.b, 0) / 4),
            };

        // ── isEmpty: transparent pixel, or within tolerance of bg colour ───
        const isEmpty = (x: number, y: number): boolean => {
          const i = (y * width + x) * 4;
          if (data[i + 3] < 10) return true; // transparent
          if (!bg) return false;              // alpha-only mode, opaque = content
          return (
            Math.abs(data[i]     - bg.r) <= AUTOCROP_TOLERANCE &&
            Math.abs(data[i + 1] - bg.g) <= AUTOCROP_TOLERANCE &&
            Math.abs(data[i + 2] - bg.b) <= AUTOCROP_TOLERANCE
          );
        };

        // ── Scan each edge inward (flag-variable pattern, no labeled breaks) 
        let top = 0;
        for (let y = 0; y < height; y++) {
          let rowEmpty = true;
          for (let x = 0; x < width; x++) { if (!isEmpty(x, y)) { rowEmpty = false; break; } }
          if (!rowEmpty) break;
          top++;
        }

        let bottom = height - 1;
        for (let y = height - 1; y >= top; y--) {
          let rowEmpty = true;
          for (let x = 0; x < width; x++) { if (!isEmpty(x, y)) { rowEmpty = false; break; } }
          if (!rowEmpty) break;
          bottom--;
        }

        let left = 0;
        for (let x = 0; x < width; x++) {
          let colEmpty = true;
          for (let y = top; y <= bottom; y++) { if (!isEmpty(x, y)) { colEmpty = false; break; } }
          if (!colEmpty) break;
          left++;
        }

        let right = width - 1;
        for (let x = width - 1; x >= left; x--) {
          let colEmpty = true;
          for (let y = top; y <= bottom; y++) { if (!isEmpty(x, y)) { colEmpty = false; break; } }
          if (!colEmpty) break;
          right--;
        }

        // ── If freeAspect is off, equalise the crop on each axis so the
        //    original aspect ratio is preserved. We take the minimum trim
        //    on each axis and apply it symmetrically.
        if (!freeAspect) {
          const trimX = Math.min(left, width - 1 - right);
          const trimY = Math.min(top, height - 1 - bottom);
          left   = trimX;
          right  = width - 1 - trimX;
          top    = trimY;
          bottom = height - 1 - trimY;
        }

        const cropW = right - left + 1;
        const cropH = bottom - top + 1;

        if (cropW <= 0 || cropH <= 0 || (cropW === width && cropH === height)) {
          resolve(file);
          return;
        }

        console.log(
          `[autocrop] ${file.name}: ${width}×${height} → ${cropW}×${cropH}`,
          freeAspect ? 'free aspect' : 'preserve aspect',
          bg ? `bg rgb(${bg.r},${bg.g},${bg.b})` : 'transparent bg',
          `(trimmed t:${top} b:${height - 1 - bottom} l:${left} r:${width - 1 - right})`,
        );

        const out  = document.createElement('canvas');
        out.width  = cropW;
        out.height = cropH;
        out.getContext('2d')!.drawImage(canvas, left, top, cropW, cropH, 0, 0, cropW, cropH);

        // Always output PNG — universally supported, preserves transparency,
        // TinyPNG on the server compresses and converts to WebP.
        out.toBlob(
          (blob) => {
            if (!blob) { resolve(file); return; }
            resolve(new File([blob], file.name.replace(/\.[^.]+$/, '.png'), { type: 'image/png' }));
          },
          'image/png',
        );
      } catch (err) {
        console.warn('[autocrop] failed, using original:', err);
        resolve(file);
      }
    };

    img.onerror = () => { URL.revokeObjectURL(objectUrl); resolve(file); };
    img.src = objectUrl;
  });
}

// ─── Edge-function upload ─────────────────────────────────────────────────────

interface UploadResult {
  url:            string;
  fileName:       string;
  format:         string;
  originalSize:   number;
  compressedSize: number;
  reductionPct:   number;
}

async function uploadViaEdgeFunction(
  file:        File,
  bucket:      string,
  customName?: string,
  crop?:       boolean,
  freeAspect?: boolean,
): Promise<UploadResult> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Not authenticated');

  // Apply client-side autocrop before sending if requested
  const fileToUpload = crop ? await autocropFile(file, freeAspect ?? true) : file;

  const form = new FormData();
  form.append('file',      fileToUpload);
  form.append('bucket',    bucket);
  form.append('maxWidth',  '1920');
  form.append('maxHeight', '1920');
  if (customName && customName.trim().length > 0) {
    form.append('customName', customName.trim());
  }

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
  const res = await fetch(`${supabaseUrl}/functions/v1/upload-image`, {
    method:  'POST',
    headers: { Authorization: `Bearer ${session.access_token}` },
    body:    form,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error ?? 'Upload failed');
  }

  return res.json() as Promise<UploadResult>;
}

// ─── Component ────────────────────────────────────────────────────────────────

const ImageUpload: React.FC<ImageUploadProps> = ({
  onImageUploaded,
  onMultipleUploaded,
  currentImageUrl,
  bucket           = 'product-images',
  allowMultiple    = false,
  defaultCustomName = '',
}) => {
  const [uploading,       setUploading]       = useState(false);
  const [multiUploading,  setMultiUploading]  = useState(false);
  const [uploadProgress,  setUploadProgress]  = useState<{ done: number; total: number } | null>(null);
  const [dragOver,        setDragOver]        = useState(false);
  const [compressionInfo, setCompressionInfo] = useState<{
    originalSize: number; compressedSize: number; format: string; reductionPct: number;
  } | null>(null);

  const [customName,       setCustomName]       = useState(defaultCustomName);
  const [autoCrop,         setAutoCrop]         = useState(false);
  const [cropFreeAspect,   setCropFreeAspect]   = useState(true);  // free = crop each side independently
  const [showYoutubeInput, setShowYoutubeInput] = useState(false);
  const [youtubeUrl,       setYoutubeUrl]       = useState('');

  const singleRef = useRef<HTMLInputElement>(null);
  const multiRef  = useRef<HTMLInputElement>(null);

  // ─── Single upload ───────────────────────────────────────────────────────
  const handleSingleFile = async (file: File) => {
    const isVideo = file.type === 'video/mp4' || file.type === 'video/quicktime';
    const isImage = file.type.startsWith('image/');
    if (!isImage && !isVideo) { toast.error('Kun billede- og videofiler er tilladt'); return; }
    if (file.size > 50 * 1024 * 1024) { toast.error('Fil for stor — maks 50 MB'); return; }

    setUploading(true);
    setCompressionInfo(null);
    try {
      const result = await uploadViaEdgeFunction(file, bucket, customName || undefined, autoCrop && !isVideo, cropFreeAspect);
      if (!isVideo) {
        setCompressionInfo({
          originalSize:   result.originalSize,
          compressedSize: result.compressedSize,
          format:         result.format,
          reductionPct:   result.reductionPct,
        });
      }
      onImageUploaded(result.url);
      toast.success(
        isVideo
          ? 'Video uploadet'
          : `Uploadet · ${fmtBytes(result.compressedSize)} ${result.format} (↓${result.reductionPct}%)`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload fejlede');
      setCompressionInfo(null);
    } finally {
      setUploading(false);
      if (singleRef.current) singleRef.current.value = '';
    }
  };

  const handleSingleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) handleSingleFile(f);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) handleSingleFile(f);
  };

  // ─── Multi upload ────────────────────────────────────────────────────────
  const handleMultipleFiles = async (files: File[]) => {
    const imageFiles = files.filter(f => f.type.startsWith('image/'));
    if (imageFiles.length === 0) { toast.error('Ingen billedfiler valgt'); return; }
    if (imageFiles.length !== files.length)
      toast.error(`${files.length - imageFiles.length} fil(er) sprunget over`);

    setMultiUploading(true);
    setUploadProgress({ done: 0, total: imageFiles.length });
    const urls: string[] = [];
    const errors: string[] = [];

    for (let i = 0; i < imageFiles.length; i++) {
      const perFileCustomName = customName.trim().length > 0
        ? `${customName.trim()}-${i + 1}`
        : undefined;
      try {
        const result = await uploadViaEdgeFunction(imageFiles[i], bucket, perFileCustomName, autoCrop, cropFreeAspect);
        urls.push(result.url);
        onImageUploaded(result.url);
      } catch (err) {
        errors.push(imageFiles[i].name);
      }
      setUploadProgress({ done: i + 1, total: imageFiles.length });
    }

    if (onMultipleUploaded && urls.length > 0) onMultipleUploaded(urls);
    if (errors.length > 0) toast.error(`Kunne ikke uploade: ${errors.join(', ')}`);
    if (urls.length > 0)   toast.success(`${urls.length} billede${urls.length > 1 ? 'r' : ''} uploadet`);

    setMultiUploading(false);
    setUploadProgress(null);
    if (multiRef.current) multiRef.current.value = '';
  };

  const handleMultiChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) handleMultipleFiles(files);
  };

  // ─── YouTube ─────────────────────────────────────────────────────────────
  const handleYoutubeSubmit = () => {
    const match = youtubeUrl.match(
      /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
    );
    if (!match) { toast.error('Ugyldig YouTube URL'); return; }
    onImageUploaded(`youtube:${match[1]}`, true);
    setYoutubeUrl(''); setShowYoutubeInput(false);
    toast.success('YouTube video tilføjet');
  };

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="space-y-3">

      {/* Current image preview */}
      {currentImageUrl && !currentImageUrl.startsWith('youtube:') && (
        <div className="relative">
          <img src={currentImageUrl} alt="Preview" className="w-full h-48 object-cover rounded-lg" />
          <button onClick={() => onImageUploaded('')}
            className="absolute top-2 right-2 p-1 bg-neutral-900/80 text-white rounded hover:bg-red-600 transition-colors">
            <X size={16} />
          </button>
        </div>
      )}

      {currentImageUrl?.startsWith('youtube:') && (
        <div className="relative">
          <div className="relative w-full aspect-video">
            <iframe className="absolute inset-0 w-full h-full rounded-lg"
              src={`https://www.youtube.com/embed/${currentImageUrl.split(':')[1]}`}
              title="YouTube video" frameBorder="0" allowFullScreen />
          </div>
          <button onClick={() => onImageUploaded('')}
            className="absolute top-2 right-2 p-1 bg-neutral-900/80 text-white rounded hover:bg-red-600 transition-colors">
            <X size={16} />
          </button>
        </div>
      )}

      {/* Options row: custom name + autocrop toggle */}
      <div className="space-y-2">
        {/* Custom filename */}
        <div>
          <label className="block text-xs text-neutral-400 mb-1">
            <EditableContent contentKey="file-upload-custom-name-label" fallback="Filnavn (valgfrit)" />
          </label>
          <input
            type="text"
            value={customName}
            onChange={e => setCustomName(e.target.value)}
            placeholder="f.eks. hero-banner"
            className="form-input w-full text-sm"
            disabled={uploading || multiUploading}
          />
          <p className="text-xs text-neutral-500 mt-1">
            <EditableContent
              contentKey="file-upload-custom-name-hint"
              fallback="Lad feltet være tomt for automatisk navn. Filendelse tilføjes automatisk."
            />
          </p>
        </div>

        {/* Autocrop toggle */}
        <button
          type="button"
          onClick={() => setAutoCrop(v => !v)}
          disabled={uploading || multiUploading}
          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-colors text-sm ${
            autoCrop
              ? 'bg-primary/10 border-primary/40 text-white'
              : 'bg-neutral-800/40 border-neutral-700 text-neutral-400 hover:border-neutral-500 hover:text-neutral-300'
          } ${uploading || multiUploading ? 'opacity-50 pointer-events-none' : ''}`}
        >
          <Crop size={15} className={autoCrop ? 'text-primary' : 'text-neutral-500'} />
          <div className="flex-1 text-left">
            <span className="font-medium">
              <EditableContent contentKey="file-upload-autocrop-label" fallback="Beskær tomrum automatisk" />
            </span>
            <span className="text-xs text-neutral-500 ml-2">
              <EditableContent
                contentKey="file-upload-autocrop-hint"
                fallback="Fjerner hvide/transparente kanter — ideelt til logoer"
              />
            </span>
          </div>
          {/* Toggle pill */}
          <div className={`relative w-8 h-4 rounded-full transition-colors flex-shrink-0 ${autoCrop ? 'bg-primary' : 'bg-neutral-600'}`}>
            <div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full shadow transition-transform ${autoCrop ? 'translate-x-4' : 'translate-x-0.5'}`} />
          </div>
        </button>

        {/* Free-aspect sub-option — only visible when autocrop is on */}
        {autoCrop && (
          <button
            type="button"
            onClick={() => setCropFreeAspect(v => !v)}
            disabled={uploading || multiUploading}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg border transition-colors text-sm ml-0 ${
              cropFreeAspect
                ? 'bg-primary/10 border-primary/30 text-white'
                : 'bg-neutral-800/20 border-neutral-700/60 text-neutral-400 hover:border-neutral-600 hover:text-neutral-300'
            } ${uploading || multiUploading ? 'opacity-50 pointer-events-none' : ''}`}
          >
            {/* Indent line */}
            <div className="w-px h-4 bg-neutral-600 ml-1 flex-shrink-0" />
            <div className="flex-1 text-left">
              <span className="font-medium text-xs">
                <EditableContent contentKey="file-upload-free-aspect-label" fallback="Tillad ændring af størrelsesforhold" />
              </span>
              <span className="text-xs text-neutral-500 block mt-0.5">
                <EditableContent
                  contentKey="file-upload-free-aspect-hint"
                  fallback={cropFreeAspect
                    ? "Beskærer hver kant uafhængigt — tættest muligt på motivet"
                    : "Beskærer symmetrisk — bevarer det originale størrelsesforhold"}
                />
              </span>
            </div>
            {/* Toggle pill */}
            <div className={`relative w-8 h-4 rounded-full transition-colors flex-shrink-0 ${cropFreeAspect ? 'bg-primary' : 'bg-neutral-600'}`}>
              <div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full shadow transition-transform ${cropFreeAspect ? 'translate-x-4' : 'translate-x-0.5'}`} />
            </div>
          </button>
        )}
      </div>

      {/* Compression result badge */}
      {compressionInfo && (
        <div className="p-3 bg-neutral-800/80 border border-neutral-700 rounded-lg">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-neutral-300 uppercase tracking-wide">
              <EditableContent contentKey="file-upload-komprimering" fallback="Komprimering" />
            </span>
            <span className="text-xs font-bold text-green-400 bg-green-400/10 border border-green-400/20 rounded-full px-2 py-0.5">
              ↓ {compressionInfo.reductionPct.toFixed(1)}%
            </span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <div className="flex-1 text-center bg-neutral-700/40 rounded p-1.5">
              <div className="text-neutral-500 mb-0.5">
                <EditableContent contentKey="file-upload-original" fallback="Original" />
              </div>
              <div className="text-neutral-200 font-medium">{fmtBytes(compressionInfo.originalSize)}</div>
            </div>
            <svg className="text-neutral-600 shrink-0" width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <div className="flex-1 text-center bg-green-900/20 border border-green-800/30 rounded p-1.5">
              <div className="text-green-600 mb-0.5">{compressionInfo.format}</div>
              <div className="text-green-400 font-medium">{fmtBytes(compressionInfo.compressedSize)}</div>
            </div>
          </div>
        </div>
      )}

      {/* Single drop zone */}
      <div
        className={`border-2 border-dashed rounded-lg p-4 text-center transition-colors cursor-pointer ${
          dragOver ? 'border-primary bg-primary/10' : 'border-neutral-600 hover:border-neutral-500 hover:bg-neutral-700/20'
        } ${uploading ? 'opacity-60 pointer-events-none' : ''}`}
        onClick={() => singleRef.current?.click()}
        onDrop={handleDrop}
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
      >
        <input ref={singleRef} type="file" accept="image/*,video/mp4,video/quicktime"
          className="hidden" onChange={handleSingleChange} disabled={uploading} />
        {uploading ? (
          <div className="flex items-center justify-center gap-2 text-neutral-400">
            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary" />
            <span className="text-sm">
              <EditableContent contentKey="file-upload-komprimerer-og-uploader" fallback="Komprimerer og uploader..." />
            </span>
          </div>
        ) : (
          <div className="space-y-1">
            <div className="flex items-center justify-center gap-2 text-neutral-400">
              <Upload size={18} />
              <span className="text-sm">
                <EditableContent contentKey="file-upload-klik-eller-traek" fallback="Klik eller træk et billede / video hertil" />
              </span>
            </div>
            <p className="text-xs text-neutral-500">
              <EditableContent contentKey="file-upload-formater" fallback="JPG · PNG · WebP · AVIF · GIF · MP4 · MOV — komprimeres automatisk" />
            </p>
          </div>
        )}
      </div>

      {/* Multi upload */}
      {allowMultiple && (
        <div>
          <input ref={multiRef} type="file" accept="image/*" multiple
            className="hidden" onChange={handleMultiChange} disabled={multiUploading} />
          <button type="button" onClick={() => multiRef.current?.click()} disabled={multiUploading}
            className={`w-full px-4 py-3 bg-neutral-700/30 border-2 border-dashed border-neutral-600 rounded-lg text-center hover:bg-neutral-700/50 hover:border-primary/50 transition-colors ${
              multiUploading ? 'opacity-60 pointer-events-none' : ''
            }`}>
            {multiUploading && uploadProgress ? (
              <div className="space-y-2">
                <div className="flex items-center justify-center gap-2 text-neutral-300">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary" />
                  <span className="text-sm">
                    <EditableContent contentKey="file-upload-uploader" fallback="Uploader" /> {uploadProgress.done} / {uploadProgress.total}...
                  </span>
                </div>
                <div className="w-full bg-neutral-700 rounded-full h-1.5">
                  <div className="bg-primary h-1.5 rounded-full transition-all duration-300"
                    style={{ width: `${(uploadProgress.done / uploadProgress.total) * 100}%` }} />
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center gap-2 text-neutral-300">
                <Images size={18} className="text-neutral-400" />
                <span className="text-sm">
                  <EditableContent contentKey="file-upload-vaelg-flere" fallback="Vælg flere billeder på én gang" />
                  {customName.trim().length > 0 && (
                    <span className="text-neutral-500 ml-1">
                      ({customName.trim()}-1, {customName.trim()}-2…)
                    </span>
                  )}
                </span>
              </div>
            )}
          </button>
        </div>
      )}

      {/* YouTube */}
      <div>
        {!showYoutubeInput ? (
          <button type="button" onClick={() => setShowYoutubeInput(true)}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm text-neutral-400 hover:text-white border border-neutral-700 hover:border-neutral-500 rounded-lg transition-colors">
            <Youtube size={16} />
            <span>
              <EditableContent contentKey="file-upload-tilfoej-youtube" fallback="Tilføj YouTube video i stedet" />
            </span>
          </button>
        ) : (
          <div className="flex gap-2">
            <input type="text" value={youtubeUrl} onChange={e => setYoutubeUrl(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleYoutubeSubmit()}
              placeholder="https://www.youtube.com/watch?v=..."
              className="form-input flex-1 text-sm" autoFocus />
            <button type="button" onClick={handleYoutubeSubmit}
              className="px-3 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors text-sm">
              <EditableContent contentKey="file-upload-tilfoej" fallback="Tilføj" />
            </button>
            <button type="button" onClick={() => { setShowYoutubeInput(false); setYoutubeUrl(''); }}
              className="p-2 text-neutral-400 hover:text-white transition-colors">
              <X size={16} />
            </button>
          </div>
        )}
      </div>

    </div>
  );
};

export default ImageUpload;
