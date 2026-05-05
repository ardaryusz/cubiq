import { ChevronDown } from 'lucide-react';
import type { Preset } from '../../types';

interface DraftPresetSelectorProps {
  presets: Preset[];
  value: number | null | undefined;
  onChange: (id: number) => void;
  className?: string;
  selectClassName?: string;
  iconClassName?: string;
  title?: string;
}

export default function DraftPresetSelector({
  presets,
  value,
  onChange,
  className,
  selectClassName,
  iconClassName,
  title = "Select preset for new chat"
}: DraftPresetSelectorProps) {
  return (
    <div className={className}>
      <select
        className={selectClassName}
        value={value ?? ''}
        onChange={e => onChange(Number(e.target.value))}
        title={title}
      >
        {presets.map(p => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <ChevronDown size={11} className={iconClassName} />
    </div>
  );
}
