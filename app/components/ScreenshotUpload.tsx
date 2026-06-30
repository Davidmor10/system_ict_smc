'use client';

import { useRef, useState } from 'react';

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/** Drag & drop chart-screenshot uploader. Stores images as data URLs on the trade record. */
export default function ScreenshotUpload({
  images,
  onChange,
  max = 3,
}: {
  images: string[];
  onChange: (images: string[]) => void;
  max?: number;
}) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function addFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const room = Math.max(0, max - images.length);
    const picked = Array.from(files).filter(f => f.type.startsWith('image/')).slice(0, room);
    const urls = await Promise.all(picked.map(fileToDataUrl));
    if (urls.length) onChange([...images, ...urls]);
  }

  function removeAt(i: number) {
    onChange(images.filter((_, idx) => idx !== i));
  }

  return (
    <div>
      {images.length < max && (
        <div
          onClick={() => inputRef.current?.click()}
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files); }}
          className={`flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-7 cursor-pointer transition-all duration-200 ${
            dragOver ? 'border-[#d4af37] bg-[#d4af37]/[0.06] scale-[1.005]' : 'border-[#2a2a2d] hover:border-[#3a3a3d] hover:bg-white/[0.02]'
          }`}
        >
          <span className="text-xl text-[#d4af37]/50">⤓</span>
          <span className="font-mono text-xs text-white/50 text-center">
            Drag a chart screenshot here, or <span className="text-[#d4af37]/70">click to browse</span>
          </span>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={e => addFiles(e.target.files)}
          />
        </div>
      )}

      {images.length > 0 && (
        <div className="flex gap-2 mt-3 flex-wrap">
          {images.map((src, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <div key={i} className="relative group">
              <img src={src} alt={`Screenshot ${i + 1}`} className="w-20 h-20 object-cover rounded-lg border border-[#1c1c1e]" />
              <button
                type="button"
                onClick={() => removeAt(i)}
                className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-black border border-[#333] text-white/60 text-[10px] flex items-center justify-center opacity-0 group-hover:opacity-100 hover:text-white hover:border-[#ef4444]/60 transition-all duration-150"
                aria-label="Remove screenshot"
              >✕</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
