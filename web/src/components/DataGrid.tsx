import { useState } from "react";
import type { ColumnDef, SortingState } from "@tanstack/react-table";
import { flexRender, getCoreRowModel, getSortedRowModel, useReactTable } from "@tanstack/react-table";

interface DataGridProps<T> {
  data: T[];
  columns: ColumnDef<T, any>[];
  getRowId: (row: T) => string;
  selectable?: boolean;
  selectedIds?: Set<string>;
  onSelectionChange?: (ids: Set<string>) => void;
  onRowClick?: (row: T) => void;
}

export function DataGrid<T>({ data, columns, getRowId, selectable, selectedIds, onSelectionChange, onRowClick }: DataGridProps<T>) {
  const [sorting, setSorting] = useState<SortingState>([]);

  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const allIds = data.map(getRowId);
  const allSelected = selectable && allIds.length > 0 && allIds.every((id) => selectedIds?.has(id));
  const someSelected = selectable && allIds.some((id) => selectedIds?.has(id));

  function toggleAll() {
    if (!onSelectionChange) return;
    onSelectionChange(allSelected ? new Set() : new Set(allIds));
  }

  function toggleOne(id: string) {
    if (!onSelectionChange || !selectedIds) return;
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectionChange(next);
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-sand-300">
      <table className="w-full min-w-max border-collapse text-sm">
        <thead className="sticky top-0 z-10 bg-sand-100">
          <tr>
            {selectable && (
              <th className="w-10 border-b border-sand-300 px-3 py-2 text-left">
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = Boolean(someSelected && !allSelected);
                  }}
                  onChange={toggleAll}
                  aria-label="Select all rows"
                />
              </th>
            )}
            {table.getHeaderGroups().map((hg) =>
              hg.headers.map((header) => (
                <th
                  key={header.id}
                  className="cursor-pointer select-none whitespace-nowrap border-b border-sand-300 px-3 py-2 text-left font-semibold text-sand-700"
                  onClick={header.column.getToggleSortingHandler()}
                >
                  {flexRender(header.column.columnDef.header, header.getContext())}
                  {{ asc: " ▲", desc: " ▼" }[header.column.getIsSorted() as string] ?? ""}
                </th>
              )),
            )}
          </tr>
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row, i) => {
            const id = getRowId(row.original);
            const selected = selectedIds?.has(id);
            return (
              <tr
                key={row.id}
                className={`${i % 2 === 1 ? "bg-sand-50/60" : "bg-white"} ${selected ? "!bg-gold-700/10" : ""} ${
                  onRowClick ? "cursor-pointer hover:bg-sand-100" : ""
                }`}
                onClick={() => onRowClick?.(row.original)}
              >
                {selectable && (
                  <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={Boolean(selected)} onChange={() => toggleOne(id)} aria-label="Select row" />
                  </td>
                )}
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="whitespace-nowrap border-b border-sand-200 px-3 py-2 text-sand-900">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
