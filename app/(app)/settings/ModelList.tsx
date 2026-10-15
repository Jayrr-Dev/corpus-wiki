import { StatusDot } from "@/app/(app)/_components/StatusDot";
import { Note } from "@/app/(app)/_components/bits";
import { cn } from "@/lib/utils";

type ModelListProps = {
  models: string[];
  selected: string;
  activeModel: string;
  onSelect: (model: string) => void;
};

// MODEL LIST: one row per model id; the selected row is gray, the model in use has a green dot
export function ModelList({ models, selected, activeModel, onSelect }: ModelListProps) {
  if (models.length === 0) return <Note>No model matches.</Note>;
  return (
    <ul role="listbox" aria-label="Models" className="max-h-64 overflow-y-auto rounded-xl border p-1.5">
      {models.map((model) => (
        <li key={model} role="option" aria-selected={model === selected}>
          <button
            type="button"
            onClick={() => onSelect(model)}
            className={cn("flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left font-mono text-panel transition-colors hover:bg-hover", model === selected && "bg-hover")}
          >
            <span className="min-w-0 flex-1 truncate">{model}</span>
            {model === activeModel ? <StatusDot tone="applied" label="in use" className="font-sans text-faint" /> : null}
          </button>
        </li>
      ))}
    </ul>
  );
}

