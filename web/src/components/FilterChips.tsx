interface FilterChipsProps<T extends string> {
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
}

export function FilterChips<T extends string>({ options, value, onChange }: FilterChipsProps<T>) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
              active ? "border-gold-700 bg-gold-700 text-white" : "border-sand-400 bg-white text-sand-700 hover:bg-sand-100"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
