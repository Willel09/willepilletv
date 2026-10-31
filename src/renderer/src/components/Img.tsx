import { useState, type ImgHTMLAttributes } from 'react'
import { cleanName, hue } from '../lib/format'

/** Artwork with a tasteful generated fallback when the provider image is missing or broken */
export function Img({ src, name, className = '', contain, ...rest }: ImgHTMLAttributes<HTMLImageElement> & { name: string; contain?: boolean }) {
  const [failed, setFailed] = useState<string | undefined>()
  if (!src || failed === src) {
    const h = hue(name)
    const label = cleanName(name)
    return (
      <div
        className={`grid place-items-center overflow-hidden p-3 text-center ${className}`}
        style={{ background: `linear-gradient(140deg, hsl(${h} 55% 32%), hsl(${(h + 50) % 360} 60% 16%))` }}
      >
        <span className="line-clamp-3 text-[15px] font-semibold leading-tight tracking-[-0.02em] text-white/90">{label}</span>
      </div>
    )
  }
  return (
    <img
      {...rest}
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      draggable={false}
      onError={() => setFailed(src)}
      className={`${contain ? 'object-contain' : 'object-cover'} ${className}`}
    />
  )
}
