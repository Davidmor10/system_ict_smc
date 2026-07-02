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
          className={`group flex flex-col items-center justify-center gap-2.5 rounded-2xl border border-dashed px-6 py-11 cursor-pointer transition-all duration-200 ${
            dragOver ? 'border-[#d4af37]/70 bg-[#d4af37]/[0.05] scale-[1.006]' : 'border-white/10 hover:border-[#d4af37]/30 hover:bg-white/[0.015]'
          }`}
        >
          <span
            className={`flex items-center justify-center w-11 h-11 rounded-full border transition-all duration-200 ${
              dragOver ? 'border-[#d4af37]/50 bg-[#d4af37]/10' : 'border-white/10 bg-white/[0.02] group-hover:border-[#d4af37]/25'
            }`}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className={dragOver ? 'text-[#d4af37]' : 'text-white/35 group-hover:text-[#d4af37]/60'} style={{ transition: 'color 200ms var(--ease-smooth)' }}>
              <path d="M4 16.5V18a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              <path d="M12 15V4M12 4 8 8M12 4l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <span className="text-[13px] text-white/60 text-center">
            {dragOver ? 'שחרר כדי לצרף' : 'גרור לכאן צילום מסך של הגרף'}
          </span>
          <span className="font-mono text-[10px] text-white/25 text-center max-w-[280px] leading-relaxed">
            {dragOver ? '' : <>או <span className="text-[#d4af37]/60">לחץ לבחירה</span> — ראיות הופכות כל עסקה לקלה יותר לבדיקה</>}
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
        <div className="flex gap-2.5 mt-3 flex-wrap">
          {images.map((src, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <div key={i} className="relative group onyx-pop-in">
              <img src={src} alt={`צילום מסך ${i + 1}`} className="w-20 h-20 object-cover rounded-xl border border-white/[0.06]" />
              <button
                type="button"
                onClick={() => removeAt(i)}
                className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-black border border-[#333] text-white/60 text-[10px] flex items-center justify-center opacity-0 group-hover:opacity-100 hover:text-white hover:border-[#ef4444]/60 transition-all duration-150"
                aria-label="הסר צילום מסך"
              >✕</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
