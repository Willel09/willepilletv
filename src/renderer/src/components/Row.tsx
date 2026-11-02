import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Children, useEffect, useRef, useState, type ReactNode } from 'react'
import { api } from '../store'

// TVs: a row starts with the cards that fit on screen plus a few, and grows as focus moves right. Each
// poster is ~0.7 MB of decoded image, and a home screen of 30-card rows would otherwise hold hundreds.
const STEP = api.device === 'tv' ? 10 : Infinity

/**
 * Netflix-style horizontal shelf. Its cards only exist while the row is near the screen: older TV
 * browsers (Chromium 76) ignore content-visibility, and every poster costs decoded-image memory.
 */
export function Row({ title, onSeeAll, children, count }: { title: string; onSeeAll?: () => void; children: ReactNode; count?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const section = useRef<HTMLElement>(null)
  const [near, setNear] = useState(false)
  const [limit, setLimit] = useState(STEP)
  const all = Children.toArray(children)
  const grow = (e: { target: EventTarget }) => {
    if (limit >= all.length) return
    const cards = ref.current!.children
    for (let i = cards.length - 1; i >= Math.max(0, cards.length - 4); i--) if (cards[i].contains(e.target as Node)) return setLimit(limit + STEP)
  }
  useEffect(() => {
    // measured against the scrolling page, so the margin really pre-loads the next rows
    const root = section.current!.closest('.overflow-y-auto')
    const io = new IntersectionObserver(([e]) => setNear(e.isIntersecting), { root, rootMargin: '800px 0px' })
    io.observe(section.current!)
    return () => io.disconnect()
  }, [])
  const page = (dir: number) => ref.current?.scrollBy({ left: dir * ref.current.clientWidth * 0.8, behavior: 'smooth' })
  return (
    <section ref={section} className="group/row relative [contain-intrinsic-size:auto_360px] [content-visibility:auto]">
      <header className="mb-1 flex items-baseline gap-3 px-14">
        <h2 className="text-[21px] font-semibold tracking-[-0.025em]">{title}</h2>
        {count !== undefined && <span className="text-[13px] font-medium text-fg/40">{count.toLocaleString()}</span>}
        {onSeeAll && (
          <button tabIndex={-1} onClick={onSeeAll} className="ml-auto flex items-center text-[13px] font-semibold text-fg/55 transition hover:text-fg">
            See All <ChevronRight className="size-4" />
          </button>
        )}
      </header>
      <div ref={ref} onFocus={grow} className={`no-scrollbar flex ${near ? "" : "min-h-[300px]"} scroll-px-14 gap-5 overflow-x-auto px-14 pb-10 pt-6`}>
        {near && (limit < all.length ? all.slice(0, limit) : all)}
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
