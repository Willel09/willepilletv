import { motion } from 'framer-motion'
import { Loader2 } from 'lucide-react'
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react'
import { spring } from '../lib/motion'

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'glass' | 'ghost' | 'danger'; icon?: ReactNode; size?: 'md' | 'lg' }

/** Pill button. "primary" is the bright Apple-TV-style play button. */
export function Button({ variant = 'glass', icon, size = 'md', className = '', children, ...rest }: BtnProps) {
  const v = {
    primary: 'bg-fg text-bg shadow-[0_10px_30px_-10px_rgb(0_0_0/0.6)] hover:bg-fg/90',
    glass: 'glass-thin text-fg hover:bg-fg/10',
    ghost: 'text-fg/70 hover:text-fg hover:bg-fg/8',
    danger: 'glass-thin text-red-400 hover:bg-red-500/15'
  }[variant]
  const s = size === 'lg' ? 'h-13 px-7 text-[15px]' : 'h-10 px-4.5 text-[13.5px]'
  return (
    <button
      {...rest}
      className={`inline-flex shrink-0 items-center justify-center gap-2 rounded-full font-semibold tracking-[-0.01em] transition-[background,transform,opacity] duration-200 active:scale-[0.97] disabled:opacity-40 ${s} ${v} ${className}`}
    >
      {icon}
      {children}
    </button>
  )
}

export function IconButton({ className = '', children, label, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      {...rest}
      aria-label={label}
      title={label}
      className={`glass-thin grid size-10 shrink-0 place-items-center rounded-full text-fg/85 transition hover:bg-fg/12 hover:text-fg active:scale-95 ${className}`}
    >
      {children}
    </button>
  )
}

export function Segmented<T extends string>({ value, options, onChange, layoutId }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void; layoutId: string }) {
  return (
    <div className="glass-thin inline-flex rounded-full p-1">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`relative h-8 rounded-full px-4 text-[13px] font-semibold transition-colors ${value === o.value ? 'text-fg' : 'text-fg/55 hover:text-fg/85'}`}
        >
          {value === o.value && <motion.span layoutId={layoutId} transition={spring} className="absolute inset-0 rounded-full bg-fg/15 shadow-[inset_0_1px_0_rgb(255_255_255/0.25)]" />}
          <span className="relative flex items-center gap-1.5">{o.label}</span>
        </button>
      ))}
    </div>
  )
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-7.5 w-12.5 shrink-0 rounded-full p-0.5 transition-colors duration-300 ${checked ? 'bg-accent' : 'bg-fg/18'}`}
    >
      <motion.span
        layout
        transition={spring}
        className="block size-6.5 rounded-full bg-white shadow-[0_3px_8px_rgb(0_0_0/0.3)]"
        style={{ marginLeft: checked ? 'auto' : 0 }}
      />
    </button>
  )
}

export function Field({ label, hint, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label?: string; hint?: ReactNode }) {
  return (
    <label className="block">
      {label && <span className="mb-1.5 block text-[12.5px] font-medium text-fg/60">{label}</span>}
      <input
        {...rest}
        className="h-11 w-full rounded-2xl bg-fg/7 px-4 text-[14px] text-fg shadow-[inset_0_0_0_1px_var(--glass-edge)] outline-none transition placeholder:text-fg/30 focus:bg-fg/10 focus:shadow-[inset_0_0_0_2px_var(--accent)]"
      />
      {hint && <span className="mt-1.5 block text-[12px] text-fg/45">{hint}</span>}
    </label>
  )
}

export const Spinner = ({ className = 'size-5' }: { className?: string }) => <Loader2 className={`animate-spin ${className}`} />

export function Empty({ icon, title, text, children }: { icon: ReactNode; title: string; text?: string; children?: ReactNode }) {
  return (
    <div className="grid h-full place-items-center p-10 text-center">
      <div className="max-w-md">
        <div className="glass mx-auto mb-5 grid size-18 place-items-center rounded-[24px] text-fg/80">{icon}</div>
        <h3 className="text-[22px] font-semibold tracking-[-0.02em]">{title}</h3>
        {text && <p className="mt-2 text-[14.5px] leading-relaxed text-fg/55">{text}</p>}
        {children && <div className="mt-6 flex justify-center gap-3">{children}</div>}
      </div>
    </div>
  )
}
