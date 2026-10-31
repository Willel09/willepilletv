import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useRef, type ReactNode } from 'react'

/** Netflix-style horizontal shelf. content-visibility lets the browser skip off-screen rows entirely. */
export function Row({ title, onSeeAll, children, count }: { title: string; onSeeAll?: () => void; children: ReactNode; count?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const page = (dir: number) => ref.current?.scrollBy({ left: dir * ref.current.clientWidth * 0.8, behavior: 'smooth' })
  return (
    <section className="group/row relative [contain-intrinsic-size:auto_360px] [content-visibility:auto]">
      <header className="mb-1 flex items-baseline gap-3 px-14">
        <h2 className="text-[21px] font-semibold tracking-[-0.025em]">{title}</h2>
        {count !== undefined && <span className="text-[13px] font-medium text-fg/40">{count.toLocaleString()}</span>}
        {onSeeAll && (
          <button tabIndex={-1} onClick={onSeeAll} className="ml-auto flex items-center text-[13px] font-semibold text-fg/55 transition hover:text-fg">
            See All <ChevronRight className="size-4" />
          </button>
        )}
      </header>
      <div ref={ref} className="no-scrollbar flex scroll-px-14 gap-5 overflow-x-auto px-14 pb-10 pt-6">
        {children}
      </div>
      {(['left', 'right'] as const).map((side) => (
        <button
          key={side}
          tabIndex={-1}
          aria-label={`Scroll ${side}`}
          onClick={() => page(side === 'left' ? -1 : 1)}
          className={`glass-thin absolute top-[45%] z-10 grid size-11 -translate-y-1/2 place-items-center rounded-full opacity-0 transition-opacity duration-300 group-hover/row:opacity-100 ${side === 'left' ? 'left-3' : 'right-3'}`}
        >
          {side === 'left' ? <ChevronLeft className="size-5" /> : <ChevronRight className="size-5" />}
        </button>
      ))}
    </section>
  )
}
