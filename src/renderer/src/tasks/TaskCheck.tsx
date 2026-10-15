import { Check } from 'lucide-react'
import type { Task } from '@shared/types'
import { cn } from '@/lib/utils'
import { patchTask, toast } from '../store'

/** Marks a task done, with a way back: the row leaves its group, so a misclick shouldn't lose it. */
export function completeTask(task: Task): void {
  patchTask(task.id, { status: 'done' })
  toast('Tarea hecha', { label: 'Deshacer', run: () => patchTask(task.id, { status: task.status }) }, { status: 'success' })
}

export function TaskCheck({ task, className }: { task: Task; className?: string }) {
  const done = task.status === 'done'
  return (
    <button
      role="checkbox"
      aria-checked={done}
      aria-label={done ? 'Marcar como pendiente' : 'Marcar como hecha'}
      onClick={(e) => {
        e.stopPropagation()
        if (done) patchTask(task.id, { status: 'todo' })
        else completeTask(task)
      }}
      onPointerDown={(e) => e.stopPropagation()}
      className={cn(
        'grid size-[18px] flex-none place-items-center rounded-full border-[1.5px] transition-colors',
        done ? 'border-status-read bg-status-read text-white' : task.status === 'doing' ? 'border-status-reading hover:bg-status-reading/15' : 'border-input hover:border-faint hover:bg-accent',
        className
      )}
    >
      {done ? <Check className="size-3" strokeWidth={3} /> : task.status === 'doing' ? <span className="size-2 rounded-full bg-status-reading" /> : null}
    </button>
  )
}
