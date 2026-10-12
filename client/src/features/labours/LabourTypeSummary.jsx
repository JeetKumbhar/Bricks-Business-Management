import { cn } from "../../utils/cn";
import { LABOUR_TYPE_META, LABOUR_TYPES } from "../../utils/labourTypes";

const tiles = [
  { type: LABOUR_TYPES.BIGARI, countKey: "bigari", style: "bg-blue-50 border-blue-100 text-blue-700" },
  { type: LABOUR_TYPES.MAAPVALI, countKey: "maapvali", style: "bg-violet-50 border-violet-100 text-violet-700" },
  { type: LABOUR_TYPES.PATLAVALE, countKey: "patlavale", style: "bg-amber-50 border-amber-100 text-amber-700" },
];

/** Individual Bigari, individual Maapvali and Patlavale teams, counted separately. Tap to filter. */
export default function LabourTypeSummary({ counts, activeType, onSelectType }) {
  return (
    <div className="grid grid-cols-3 gap-2 sm:gap-4">
      {tiles.map(({ type, countKey, style }) => {
        const meta = LABOUR_TYPE_META[type];
        const selected = activeType === type;
        return (
          <button
            key={type}
            type="button"
            aria-pressed={selected}
            onClick={() => onSelectType(selected ? "ALL" : type)}
            className={cn(
              "rounded-xl border p-3 text-left transition-shadow sm:p-4",
              style,
              selected && "ring-2 ring-primary"
            )}
          >
            <p className="text-xs font-medium sm:text-sm">{meta.label}</p>
            <p className="mt-1 text-2xl font-bold leading-none text-fg sm:text-3xl">{counts[countKey]}</p>
            <p className="mt-1 text-[11px] sm:text-xs">{meta.plural}</p>
          </button>
        );
      })}
    </div>
  );
}
