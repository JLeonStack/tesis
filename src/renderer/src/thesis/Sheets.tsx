import { useEffect, useRef } from 'react'
import type { ThesisAuthorizations, ThesisMeta } from '@shared/types'
import { cn } from '@/lib/utils'
import logo from '../assets/ucema-logo.png'
import { AUTHORIZATIONS, CAREER, UNIVERSITY, authRuns, longDate } from './template'

type Patch = (patch: Partial<ThesisMeta> | ((m: ThesisMeta) => Partial<ThesisMeta>)) => void

function AutoText({ value, onChange, placeholder, className }: { value: string; onChange: (v: string) => void; placeholder: string; className?: string }) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = '0'
    el.style.height = `${el.scrollHeight}px`
  }, [value])
  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      spellCheck
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value.replace(/\n/g, ' '))}
      className={cn('cover-field resize-none overflow-hidden', className)}
    />
  )
}

/** Portada, laid out like the UCEMA template; every placeholder is an input. */
export function CoverSheet({ meta, onChange }: { meta: ThesisMeta; onChange: Patch }) {
  const dateRef = useRef<HTMLInputElement>(null)
  return (
    <section className="thesis-sheet cover-sheet">
      <div className="sheet-label">Portada</div>
      <div className="cover-line center">
        <img src={logo} alt="UCEMA" className="cover-logo" draggable={false} />
      </div>
      <div className="cover-line" />
      <div className="cover-line center cover-14 bold">{UNIVERSITY}</div>
      <div className="cover-line center cover-14 bold">{CAREER}</div>
      <div className="cover-gap" />
      <AutoText className="center cover-24 bold" value={meta.title} placeholder="Título" onChange={(title) => onChange({ title })} />
      <AutoText className="center cover-24 bold" value={meta.subtitle} placeholder="Subtítulo (opcional)" onChange={(subtitle) => onChange({ subtitle })} />
      <div className="cover-line center cover-24 bold">Trabajo Final</div>
      <div className="cover-line" />
      <div className="cover-line" />
      <div className="cover-line" />
      <div className="cover-line right cover-16">
        <b>Autor:</b>{' '}
        <input className="cover-field cover-inline" value={meta.author} placeholder="Nombre y apellido" onChange={(e) => onChange({ author: e.target.value })} size={Math.max(16, meta.author.length + 1)} />
      </div>
      <div className="cover-line right cover-16">
        <b>Tutor:</b>{' '}
        <input className="cover-field cover-inline" value={meta.tutorDegree} placeholder="Grado" title="Grado académico del tutor (p. ej., Dr., Mg., Lic.)" onChange={(e) => onChange({ tutorDegree: e.target.value })} size={Math.max(5, meta.tutorDegree.length + 1)} />{' '}
        <input className="cover-field cover-inline" value={meta.tutor} placeholder="Nombre y apellido" onChange={(e) => onChange({ tutor: e.target.value })} size={Math.max(16, meta.tutor.length + 1)} />
      </div>
      <div className="cover-line right cover-14">
        <button type="button" className="cover-date" title="Cambiar fecha" onClick={() => dateRef.current?.showPicker()}>
          {longDate(meta.date)}
        </button>
        <input ref={dateRef} type="date" className="sr-only" tabIndex={-1} value={meta.date} onChange={(e) => e.target.value && onChange({ date: e.target.value })} />
      </div>
    </section>
  )
}

/** Última página: publication authorizations, signed by the author. */
export function AuthorizationsSheet({ meta, onChange }: { meta: ThesisMeta; onChange: Patch }) {
  const setAuth = (key: keyof ThesisAuthorizations, v: boolean) => onChange((m) => ({ auth: { ...m.auth, [key]: v } }))
  return (
    <section className="thesis-sheet auth-sheet">
      <div className="sheet-label">Última página</div>
      <div className="sheet-title">Autorizaciones</div>
      <ul className="auth-list">
        {AUTHORIZATIONS.map((a) => {
          const v = meta.auth[a.key]
          return (
            <li key={a.key}>
              <div className="auth-head">{a.label}</div>
              <div className="auth-options">
                {[true, false].map((yes) => (
                  <button
                    key={String(yes)}
                    type="button"
                    className={cn('auth-option', v === yes && 'on', v !== null && v !== yes && 'off')}
                    onClick={() => setAuth(a.key, yes)}
                  >
                    {authRuns(yes, a).map((r, i) => (r.bold ? <b key={i}>{r.text}</b> : r.text))}
                  </button>
                ))}
              </div>
            </li>
          )
        })}
      </ul>
      <div className="auth-sign">
        <div>
          Nombre y apellido: <span className={cn(!meta.author && 'faint')}>{meta.author || '(completalo en la portada)'}</span>
        </div>
        <div>
          DNI: <input className="cover-field cover-inline" value={meta.dni} placeholder="00.000.000" onChange={(e) => onChange({ dni: e.target.value })} size={12} />
        </div>
        <div>Carrera: {CAREER}</div>
        <div>
          Firma: <span className="auth-signature" />
        </div>
      </div>
    </section>
  )
}
