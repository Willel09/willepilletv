import { Check, Plus } from 'lucide-react'
import { useState } from 'react'
import type { Movie, Show } from '../../../shared/types'
import { createList, listsOf, toggleInList, useApp } from '../store'
import { Sheet } from './Sheet'
import { Button, Field } from './ui'

/** "Save to list": tick the lists a film or series is in, or start a new one with it */
export function ListSheet({ item, onClose }: { item: Movie | Show; onClose: () => void }) {
  const all = useApp((s) => s.customLists)
  const profile = useApp((s) => s.activeProfile)
  const mine = listsOf(all, profile)
  const [name, setName] = useState('')
  const make = () => createList(name, item) && setName('')
  return (
    <Sheet title="Save to list" onClose={onClose} width={480}>
      {mine.length === 0 && <p className="mb-4 text-[14px] text-fg/55">You have no lists yet. Name your first one below.</p>}
      <div className="mb-5 space-y-2">
        {mine.map((l, i) => {
          const on = l.items.some((x) => x.id === item.id)
          return (
            <button key={l.id} data-nav-default={i === 0 ? '' : undefined} onClick={() => toggleInList(l.id, item)} className="flex w-full items-center gap-3 rounded-2xl bg-fg/7 px-4 py-3 text-left transition hover:bg-fg/12">
              <span className={`grid size-6 shrink-0 place-items-center rounded-full ${on ? 'bg-[var(--accent)] text-white' : 'bg-fg/12 text-transparent'}`}>
                <Check className="size-4" />
              </span>
              <span className="min-w-0 flex-1 truncate text-[15px] font-medium">{l.name}</span>
              <span className="text-[12.5px] text-fg/45">{l.items.length}</span>
            </button>
          )
        })}
      </div>
      <div className="flex items-end gap-3">
        <div className="flex-1">
          <Field label="New list" placeholder="e.g. Weekend movies" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && make()} />
        </div>
        <Button variant="primary" icon={<Plus className="size-4" />} onClick={make} disabled={!name.trim()}>
          Create
        </Button>
      </div>
    </Sheet>
  )
}
