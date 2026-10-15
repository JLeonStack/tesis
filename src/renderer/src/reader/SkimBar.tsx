import { motion } from "motion/react";
import { ChevronDown, ChevronUp, Compass, X } from "lucide-react";
import type { PaperGuide, SkimFacet } from "@shared/types";
import { cn } from "@/lib/utils";
import { Hint, IconButton } from "../components/common";
import { useStore } from "../store";
import { FACETS, skimMinutes } from "../lib/guide";
import { mod } from "../lib/util";

/**
 * Skim mode controls under the reader toolbar: which kinds of key sentences
 * are marked, and stepping through them in reading order (J / K).
 */
export function SkimBar({
  guide,
  position,
  total,
  onStep,
  onClose,
}: {
  guide: PaperGuide;
  position: number | null;
  total: number;
  onStep: (dir: 1 | -1) => void;
  onClose: () => void;
}) {
  const facets = useStore((s) => s.skimFacets);
  const toggle = (f: SkimFacet, only: boolean) =>
    useStore.setState((s) => {
      if (only)
        return {
          skimFacets:
            s.skimFacets.length === 1 && s.skimFacets[0] === f
              ? FACETS.map((x) => x.id)
              : [f],
        };
      const next = s.skimFacets.includes(f)
        ? s.skimFacets.filter((x) => x !== f)
        : [...s.skimFacets, f];
      return { skimFacets: next.length ? next : FACETS.map((x) => x.id) };
    });

  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: "auto", opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{
        type: "spring",
        stiffness: 520,
        damping: 42,
        opacity: { duration: 0.12 },
      }}
      style={{ overflow: "clip" }}
      className="flex-none border-b bg-background"
    >
      <div className="flex h-9 items-center gap-1 pr-2 pl-3">
        <span className="mr-1 flex-none text-xs font-semibold">Lectura rápida</span>
        <span className="mr-1.5 flex-none text-[11.5px] whitespace-nowrap text-faint tabular-nums">
          ~{skimMinutes(guide)} min
        </span>
        {/* Scrolls sideways when the reader is narrow, fading at the edge. */}
        <div className="scrollbar-none flex min-w-0 flex-1 items-center gap-1 overflow-x-auto pr-3 [mask-image:linear-gradient(to_right,black_calc(100%-16px),transparent)]">
          {FACETS.map((f) => {
            const on = facets.includes(f.id);
            const count = guide.sentences.filter(
              (s) => s.facet === f.id && s.rects.length,
            ).length;
            return (
              <Hint key={f.id} label={`${f.hint} · ⌥-clic para mostrar solo estas`}>
                <button
                  aria-pressed={on}
                  onClick={(e) => toggle(f.id, e.altKey)}
                  disabled={!count}
                  className={cn(
                    "inline-flex h-6 flex-none items-center gap-1.5 rounded-full px-2 text-[11.5px] font-medium whitespace-nowrap transition-colors disabled:opacity-40",
                    on
                      ? "bg-muted text-foreground"
                      : "text-faint hover:text-muted-foreground",
                  )}
                >
                  <span
                    aria-hidden
                    className="h-[3px] w-3 rounded-full transition-opacity"
                    style={{
                      background: `var(--skim-${f.id})`,
                      opacity: on ? 1 : 0.35,
                    }}
                  />
                  {f.label}
                  <span className="text-faint tabular-nums">{count}</span>
                </button>
              </Hint>
            );
          })}
        </div>
        <span className="mr-0.5 flex-none text-[11.5px] whitespace-nowrap text-muted-foreground tabular-nums">
          {total
            ? `${position == null ? "–" : position + 1} / ${total}`
            : "Ninguna visible"}
        </span>
        <IconButton
          size="icon-xs"
          label="Oración clave anterior"
          keys={["K"]}
          disabled={!total}
          onClick={() => onStep(-1)}
        >
          <ChevronUp />
        </IconButton>
        <IconButton
          size="icon-xs"
          label="Oración clave siguiente"
          keys={["J"]}
          disabled={!total}
          onClick={() => onStep(1)}
        >
          <ChevronDown />
        </IconButton>
        <IconButton
          size="icon-xs"
          label="Abrir la guía de lectura"
          onClick={() =>
            useStore.setState({ rightOpen: true, rightTab: "guide" })
          }
        >
          <Compass />
        </IconButton>
        <IconButton
          size="icon-xs"
          label="Desactivar la lectura rápida"
          keys={[mod, "⌥", "S"]}
          onClick={onClose}
        >
          <X />
        </IconButton>
      </div>
    </motion.div>
  );
}
