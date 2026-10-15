import { describe, expect, it, vi } from 'vitest'
import type { Settings, Task } from '@shared/types'

vi.mock('../store', () => ({ createTask: vi.fn(), deleteTask: vi.fn(), patchTask: vi.fn(), restoreTask: vi.fn(), toast: vi.fn(), useStore: { getState: vi.fn() } }))
vi.mock('../pomodoro/timer', () => ({ PRESETS: [{}, {}] }))

const { planChanges, planSchedule } = await import('./plan')

const settings = { research: { constructs: [], demographics: [], hypotheses: '' }, researchQuestion: '' } as unknown as Settings
const task = (t: Partial<Task>): Task => ({ id: t.phaseId ?? t.title ?? 'x', title: '', notes: '', status: 'todo', priority: 'normal', createdAt: 0, updatedAt: 0, ...t }) as Task

describe('plan by delivery', () => {
  it('lands each stage before its delivery and the whole work by the final one', () => {
    const items = planSchedule('2026-10-10')
    const due = (id: string) => items.find((it) => it.phaseId === id)!.due
    expect(due('method') < '2026-10-15').toBe(true)
    expect(due('literature') > '2026-10-15' && due('analysis') < '2026-11-12').toBe(true)
    expect(due('results') > '2026-11-12' && due('revision') < '2026-12-02').toBe(true)
    expect(due('m:delivery-1')).toBe('2026-10-15')
    expect(due('m:delivery-2')).toBe('2026-11-12')
    expect(due('m:tutor')).toBe('2026-12-02')
    expect(due('m:approval')).toBe('2026-12-03')
    expect(due('m:deadline')).toBe('2026-12-10')
    expect(items.every((it) => it.due <= '2026-12-10')).toBe(true)
  })

  it('moves an old plan to the deliveries and drops milestones the calendar no longer has', () => {
    const tasks = [
      task({ phaseId: 'revision', title: 'Leer todo y corregir', start: '2026-12-13', due: '2026-12-19' }),
      task({ phaseId: 'm:deadline', title: 'Entregar el trabajo final en PDF', due: '2026-12-28', milestone: true }),
      task({ phaseId: 'm:checkpoint-2026-10-15', title: 'Entrega 1 del taller', due: '2026-10-15', milestone: true }),
      task({ phaseId: 'analysis', title: 'Analizar los datos', status: 'done', start: '2026-11-14', due: '2026-11-24' })
    ]
    const c = planChanges(settings, tasks, '2026-10-10')
    expect(c.move.map((m) => m.task.phaseId)).toEqual(['revision', 'm:deadline'])
    expect(c.move.find((m) => m.task.phaseId === 'm:deadline')!.item.due).toBe('2026-12-10')
    expect(c.remove.map((t) => t.phaseId)).toEqual(['m:checkpoint-2026-10-15'])
    expect(c.add.some((it) => it.phaseId === 'analysis')).toBe(false)
  })

  it("doesn't duplicate a delivery the student already has as a task", () => {
    const tasks = [task({ title: 'Entregar documento (entrega 1)', due: '2026-10-15', milestone: true }), task({ phaseId: 'm:delivery-1', title: 'Entrega 1 del taller', due: '2026-10-15', milestone: true })]
    const c = planChanges(settings, tasks, '2026-10-10')
    expect(c.add.some((it) => it.phaseId === 'm:delivery-1')).toBe(false)
    expect(c.remove.map((t) => t.phaseId)).toEqual(['m:delivery-1'])
  })
})
