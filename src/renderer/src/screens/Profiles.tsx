// "Who's watching?" picker and the add/edit profile sheet.
import { motion } from 'framer-motion'
import { Check, Pencil, Plus } from 'lucide-react'
import { useState } from 'react'
import type { Profile } from '../../../shared/types'
import { Avatar, AVATARS } from '../components/Avatar'
import { Sheet } from '../components/Sheet'
import { Button, Field } from '../components/ui'
import { softSpring } from '../lib/motion'
import { deleteProfile, profilesOf, saveProfile, switchProfile, useApp } from '../store'

export function ProfileSheet({ profile, onClose }: { profile: Profile | null; onClose: () => void }) {
  const taken = new Set(profilesOf(useApp.getState().profiles).map((p) => p.avatar))
  const [name, setName] = useState(profile?.name ?? '')
  const [avatar, setAvatar] = useState(profile?.avatar ?? AVATARS.find((a) => !taken.has(a.id))?.id ?? AVATARS[0].id)
  const save = () => {
    if (!name.trim()) return
    saveProfile({ id: profile?.id ?? `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name: name.trim().slice(0, 24), avatar })
    onClose()
  }
  return (
    <Sheet title={profile ? 'Edit profile' : 'Add profile'} onClose={onClose} width={560}>
      <div className="mb-6 flex items-center gap-5">
        <Avatar id={avatar} className="size-24" />
        <div className="flex-1">
          <Field label="Name" placeholder="e.g. Alex" value={name} autoFocus maxLength={24} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} />
        </div>
      </div>
      <div className="mb-2 text-[12.5px] font-medium text-fg/60">Choose an avatar</div>
      <div className="grid grid-cols-6 gap-3" role="radiogroup" aria-label="Avatar">
        {AVATARS.map((a) => (
          <button key={a.id} role="radio" aria-checked={a.id === avatar} aria-label={a.label} title={a.label} onClick={() => setAvatar(a.id)} className={`relative rounded-[30%] p-0.5 transition ${a.id === avatar ? 'ring-[3px] ring-fg' : 'opacity-80 hover:scale-105 hover:opacity-100'}`}>
            <Avatar id={a.id} className="aspect-square w-full" />
          </button>
        ))}
      </div>
      <div className="mt-7 flex items-center gap-3">
        {profile && profile.id !== 'main' && (
          <Button variant="ghost" className="text-red-400" onClick={() => (deleteProfile(profile.id), onClose())}>
            Delete profile
          </Button>
        )}
        <div className="flex-1" />
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" icon={<Check className="size-4" />} onClick={save} disabled={!name.trim()}>
          Save
        </Button>
      </div>
      {profile && profile.id !== 'main' && <p className="mt-3 text-[12px] text-fg/40">Deleting removes this profile's watchlist, favorites and history on all your devices.</p>}
    </Sheet>
  )
}

/** Full-screen "Who's watching?" */
export function ProfilePicker() {
  const profiles = profilesOf(useApp((s) => s.profiles))
  const active = useApp((s) => s.activeProfile)
  const [manage, setManage] = useState(false)
  const [editing, setEditing] = useState<Profile | null | undefined>(undefined)
  return (
    <motion.div data-nav-scope className="fixed inset-0 z-40 grid place-items-center overflow-y-auto bg-[rgb(var(--base-rgb)/0.88)] px-6 py-16 backdrop-blur-2xl" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="w-full max-w-4xl text-center">
        <motion.h1 initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={softSpring} className="mb-12 text-[36px] font-bold tracking-[-0.035em] md:text-[48px]">
          {manage ? 'Manage profiles' : "Who's watching?"}
        </motion.h1>
        <div className="flex flex-wrap justify-center gap-6 md:gap-9">
          {profiles.map((p, i) => (
            <motion.button
              key={p.id}
              autoFocus={p.id === active}
              initial={{ y: 30, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ ...softSpring, delay: 0.05 * i }}
              onClick={() => (manage ? setEditing(p) : switchProfile(p.id))}
              className="group flex w-28 flex-col items-center gap-3 rounded-[28px] p-2 outline-none md:w-36"
            >
              <span className="relative block w-full">
                <span className="block rounded-[30%] transition group-hover:scale-105 group-focus-visible:scale-105 group-focus-visible:ring-4 group-focus-visible:ring-fg">
                  <Avatar id={p.avatar} className="aspect-square w-full" title={p.name} />
                </span>
                {manage && <span className="absolute inset-0 grid place-items-center rounded-[30%] bg-black/45"><Pencil className="size-8 text-white" /></span>}
              </span>
              <span className={`max-w-full truncate text-[15px] font-semibold ${p.id === active ? 'text-fg' : 'text-fg/65 group-hover:text-fg'}`}>{p.name}</span>
            </motion.button>
          ))}
          {profiles.length < 8 && (
            <motion.button initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ ...softSpring, delay: 0.05 * profiles.length }} onClick={() => setEditing(null)} className="group flex w-28 flex-col items-center gap-3 rounded-[28px] p-2 outline-none md:w-36">
              <span className="glass-thin grid aspect-square w-full place-items-center rounded-[30%] transition group-hover:scale-105 group-focus-visible:ring-4 group-focus-visible:ring-fg">
                <Plus className="size-10 text-fg/60" />
              </span>
              <span className="text-[15px] font-semibold text-fg/65 group-hover:text-fg">Add profile</span>
            </motion.button>
          )}
        </div>
        <div className="mt-12 flex justify-center gap-3">
          <Button onClick={() => setManage((m) => !m)} icon={manage ? <Check className="size-4" /> : <Pencil className="size-4" />}>
            {manage ? 'Done' : 'Manage profiles'}
          </Button>
          {!manage && <Button variant="ghost" onClick={() => useApp.setState({ pickProfile: false })}>Close</Button>}
        </div>
      </div>
      {editing !== undefined && <ProfileSheet profile={editing} onClose={() => setEditing(undefined)} />}
    </motion.div>
  )
}
