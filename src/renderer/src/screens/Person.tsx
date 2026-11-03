import { motion } from 'framer-motion'
import { ChevronLeft, Star } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Movie, Show } from '../../../shared/types'
import type { Person, TmdbTitle } from '../../../shared/core/tmdb'
import { PosterCard } from '../components/Cards'
import { Img } from '../components/Img'
import { Row } from '../components/Row'
import { Button, IconButton, Spinner } from '../components/ui'
import { sheetSpring, softSpring } from '../lib/motion'
import { matchLibrary, usePerson } from '../lib/tmdb'
import { closePerson, openDetail, setTab, useApp } from '../store'

const when = (d: string) => new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })

/** Facts worth a glance: how many, how good on average, the one they're best rated for */
function facts(p: Person, role: 'actor' | 'director'): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = []
  if (p.age !== undefined) out.push({ label: p.died ? 'Died aged' : 'Age', value: String(p.age) })
  if (p.count) out.push({ label: role === 'director' ? 'Directed' : 'In', value: `${p.count} ${p.count === 1 ? 'title' : 'titles'}` })
  if (p.average) out.push({ label: 'Average rating', value: `${p.average.toFixed(1)} / 10` })
  const best = p.credits.filter((c) => c.rating && c.votes >= 500).sort((a, b) => b.rating! - a.rating!)[0]
  if (best) out.push({ label: 'Best rated', value: `${best.title}${best.year ? ` (${best.year})` : ''} · ${best.rating!.toFixed(1)}` })
  return out
}

export default function PersonPage({ name, role }: { name: string; role: 'actor' | 'director' }) {
  const state = usePerson(name, role)
  const root = useRef<HTMLDivElement>(null)
  const [own, setOwn] = useState<{ credit: TmdbTitle; title: Movie | Show }[] | null>(null)
  const [more, setMore] = useState(false)
  const p = state.person

  // which of their films the library has
  useEffect(() => {
    setOwn(null)
    if (!p) return
    let live = true
    void matchLibrary(p.credits).then((m) => {
      if (!live) return
      const seen = new Set<string>()
      setOwn(p.credits.flatMap((credit) => (m.has(credit.tmdb) && !seen.has(m.get(credit.tmdb)!.id) ? (seen.add(m.get(credit.tmdb)!.id), [{ credit, title: m.get(credit.tmdb)! }]) : [])))
    })
    return () => void (live = false)
  }, [p])
  useEffect(() => root.current?.querySelector<HTMLElement>('button')?.focus({ preventScroll: true }), [p])

  const owned = useMemo(() => new Set((own ?? []).map((o) => o.credit.tmdb)), [own])
  const others = useMemo(() => (p?.credits ?? []).filter((c) => !owned.has(c.tmdb)), [p, owned])
  useApp((s) => s.settings.tmdbKey)

  return (
    <motion.div
      ref={root}
      data-nav-scope
      className="fixed inset-0 z-40 overflow-y-auto overflow-x-hidden bg-[var(--app-bg)]"
      initial={{ opacity: 0, y: 60 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 40 }}
      transition={sheetSpring}
    >
      <div className="relative flex flex-wrap items-start gap-10 px-14 pb-10 pt-24">
        <IconButton label="Back" onClick={closePerson} className="absolute left-14 top-10 size-11">
          <ChevronLeft className="size-5" />
        </IconButton>
        <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ ...softSpring, delay: 0.06 }} className="w-[200px] shrink-0 overflow-hidden rounded-[28px] shadow-[0_40px_80px_-20px_rgb(0_0_0/0.8)] ring-1 ring-white/15">
          <Img src={p?.photo} name={name} size={342} className="aspect-[2/3] w-full" />
        </motion.div>
        <div className="min-w-0 max-w-3xl flex-1">
          <div className="mb-2 text-[12px] font-semibold uppercase tracking-[0.14em] text-fg/55">{role === 'director' ? 'Director' : 'Actor'}</div>
          <h1 className="text-[44px] font-[800] leading-none tracking-[-0.04em] lg:text-[60px]">{name}</h1>

          {state.status === 'nokey' && (
            <div className="glass mt-8 max-w-xl rounded-[24px] p-6">
              <p className="text-[15px] leading-relaxed text-fg/75">
                To see how old {name} is, what they have been in and which of their films you have, add a free TMDB key in Settings (Ratings). It takes a minute and is only an email.
              </p>
              <Button className="mt-4" variant="primary" onClick={() => (closePerson(), setTab('settings'))}>Open Settings</Button>
            </div>
          )}
          {state.status === 'loading' && <div className="mt-8 flex items-center gap-3 text-fg/55"><Spinner /> Looking up {name}…</div>}
          {state.status === 'missing' && <p className="mt-8 text-fg/55">TMDB doesn't know anyone called “{name}”.</p>}
          {state.status === 'error' && <p className="mt-8 text-fg/55">Couldn't look {name} up: {state.error}</p>}

          {p && (
            <>
              <div className="mt-6 flex flex-wrap gap-3">
                {facts(p, role).map((f) => (
                  <div key={f.label} className="glass-thin rounded-2xl px-4 py-2.5">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-fg/45">{f.label}</div>
                    <div className="mt-0.5 flex items-center gap-1.5 text-[15px] font-semibold">
                      {f.label === 'Average rating' && <Star className="size-3.5 fill-amber-300 text-amber-300" />}
                      {f.value}
                    </div>
                  </div>
                ))}
              </div>
              {(p.born || p.birthplace) && (
                <p className="mt-4 text-[13.5px] text-fg/55">
                  Born {p.born ? when(p.born) : ''}
                  {p.birthplace ? ` in ${p.birthplace}` : ''}
                  {p.died ? ` · died ${when(p.died)}` : ''}
                </p>
              )}
              {p.bio && (
                <>
                  <p className={`mt-4 max-w-2xl whitespace-pre-line text-[15px] leading-relaxed text-fg/75 ${more ? '' : 'line-clamp-5'}`}>{p.bio}</p>
                  {p.bio.length > 450 && (
                    <button onClick={() => setMore(!more)} className="mt-2 text-[13px] font-semibold text-fg/60 hover:text-fg">
                      {more ? 'Show less' : 'Read more'}
                    </button>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>

      {p && (
        <div className="pb-16">
          {own === null ? (
            <div className="flex items-center gap-3 px-14 pb-8 text-fg/50"><Spinner className="size-4" /> Checking your library…</div>
          ) : own.length > 0 ? (
            <Row title="In your library" count={own.length}>
              {own.map(({ title }) => (
                <PosterCard key={title.id} name={title.name} poster={title.poster} rating={title.rating} onClick={() => (closePerson(), openDetail(title))} />
              ))}
            </Row>
          ) : (
            <p className="px-14 pb-8 text-[14px] text-fg/50">None of {name}'s best known titles are in your library.</p>
          )}
          {others.length > 0 && (
            <section className="px-14">
              <h2 className="mb-4 text-[21px] font-semibold tracking-[-0.025em]">{own?.length ? 'Not in your library' : 'Known for'}</h2>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(130px,1fr))] gap-4 opacity-80">
                {others.slice(0, 30).map((c) => (
                  <div key={`${c.kind}${c.tmdb}`} className="min-w-0">
                    <Img src={c.poster} name={c.title} size={342} className="aspect-[2/3] w-full rounded-2xl" />
                    <div className="mt-2 truncate text-[12.5px] font-medium text-fg/80">{c.title}</div>
                    <div className="truncate text-[11.5px] text-fg/45">
                      {[c.year, c.rating ? `★ ${c.rating.toFixed(1)}` : '', c.role].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </motion.div>
  )
}
