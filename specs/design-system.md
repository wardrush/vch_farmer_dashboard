# design-system.md — VCH visual language

Captured live from https://intake.veteranscarbonholdings.com/intake (2026-07-15). The dashboards must read as the same product family as the intake form (R20). It's a Tailwind app; adopt these as Tailwind theme tokens.

## Tokens

```js
// tailwind theme extension
colors: {
  sand: {
    50:  '#FBF8F1',   // page highlights
    100: '#F7F1E5',   // gradient start
    200: '#F4ECD9',   // gradient end
    300: '#ECE1CD',   // gradient mid, card borders (border-sand-300)
    400: '#C7B08A',   // input borders
    700: '#46331F',   // secondary text/buttons
    900: '#312213',   // body text
    950: '#1F1408',   // headings
  },
  gold: {
    700: '#A67C17',   // PRIMARY accent: active pills, primary buttons
    800: '#8A6612',   // hover
  },
  sage: 'rgba(198,219,181,0.55)', // background radial tint
}
fontFamily: { sans: ['Quicksand', 'sans-serif'] }
```

- **Background:** `radial-gradient(circle at 12% 20%, rgba(255,255,255,.92), transparent 38%), radial-gradient(circle at 90% 12%, rgba(198,219,181,.55), transparent 42%), linear-gradient(132deg, #F7F1E5, #ECE1CD 46%, #F4ECD9)` — fixed attachment.
- **Header:** sticky, `bg-white/85 backdrop-blur border-b border-sand-300/80`; VCH monogram circle + small-caps "VETERAN'S CARBON HOLDINGS" over the app-section name (`Enrollment` → here: `Grower Dashboard` / `Analyst` / `Admin`).
- **Cards:** `bg-white/95 rounded-3xl border border-sand-300 p-6 space-y-6`.
- **Headings:** Quicksand 700; h1 48px, letter-spacing −0.02em, color sand-950.
- **Body:** Quicksand, 1.45 line-height, sand-900.
- **Primary button:** `rounded-full bg-gold-700 text-white font-semibold px-5 py-2` (hover gold-800). Secondary: transparent, sand-700 text, `rounded-xl border`.
- **Inputs/selects:** `bg-white rounded-xl border border-sand-400 px-4 py-3`.
- **Step pill (the tracker unit):** `rounded-xl border px-4 py-3 text-sm font-semibold`; number chip `rounded-full bg-black/10 px-2 py-0.5 mr-2`. Active = `bg-gold-700 text-white`; completed = gold outline + gold check chip; pending = sand border, sand-500 text.

## Component inventory (build once in `web/src/components/`)

| Component | Used by | Notes |
|---|---|---|
| `StageTracker` | farmer, analyst, admin | Horizontal pill bar; props: stages[], currentIdx, size (`macro`/`micro`), onExpand. Macro bar expands into micro bar (R1 zoom in/out) with a smooth height transition. Completed pills get a check; current pill pulses subtly (Domino's energy, VCH restraint). Mobile: horizontal scroll with snap. |
| `StatCard` | all | Big number + label + optional footnote link (e.g. credits caveat). |
| `MapInlay` | farmer, analyst | MapLibre wrapper card, rounded-3xl clipped; see `specs/maps.md`. |
| `DataGrid` | admin, analyst | Sortable/filterable table w/ checkbox multiselect; sticky header; sand-striped rows. TanStack Table is fine. |
| `FilterChips` | analyst | Period/year/region toggles — pill visual language. |
| `Callout` | all | The "measured ≠ credited" explainer, "demo data" notices. Sand-100 bg, gold left rule. |
| `DemoBadge` | all | Tiny `demo` chip rendered wherever `demo_fabricated` data is shown. Keeps the demo honest. |

## Charts (analyst)

If charts are added (per-stratum bars, baseline-vs-monitoring TOC distributions): follow the repo `dataviz` skill guidance at build time; single-hue gold/sand ramp for sequential, one green accent (`#5B7B4C`, from the sage tint family) for "monitoring/treated" vs sand for "baseline". No reds except QA outlier flags (`#B3402A`).

## Voice

Farmer surfaces: plain language, no acronyms without expansion, reassuring but concrete (mirror the tone of Ward's grower email). Analyst/admin surfaces: dense, terse, jargon allowed.
