# Skill: Wiring a Complete Collection UI

## Purpose
Guide for assembling a working collection UI by connecting zodal's headless generators, a DataProvider adapter, a renderer package, and state management. This is the "last mile" — taking the pieces and making them work together.

## When to Use
- Building a table/list view with sorting, filtering, pagination
- Building create/edit forms from a schema
- Connecting a DataProvider to a React UI via Zustand
- Integrating TanStack Table with zodal column configs
- Assembling all zodal pieces into a working page

## Prerequisites

You need these pieces:
1. **A Zod schema** defining your collection
2. **A DataProvider** (in-memory, Supabase, REST, etc.) — see `zodal-store-adapter` skill
3. **A renderer package** (shadcn, MUI, etc.) — see `zodal-ui-renderer` skill

## End-to-End Wiring

### Step 1: Define the collection

```typescript
import { z } from 'zod';
import { defineCollection } from '@zodal/core';

const ProjectSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  status: z.enum(['draft', 'active', 'archived']),
  priority: z.number().int().min(1).max(5),
  createdAt: z.date(),
});

const projects = defineCollection(ProjectSchema, {
  affordances: {
    selectable: 'multi',
    search: true,
    pagination: { defaultPageSize: 25 },
    bulkDelete: true,
    export: ['csv'],
  },
  fields: {
    status: { badge: { draft: 'secondary', active: 'default', archived: 'outline' } },
    name: { inlineEditable: true },
  },
});
```

### Step 2: Create the DataProvider

```typescript
import { createSupabaseProvider } from 'zodal-store-supabase';
// or: import { createInMemoryProvider } from '@zodal/store';

const provider = createSupabaseProvider<Project>({
  client: supabase,
  table: 'projects',
  idField: 'id',
});
```

### Step 3: Generate UI configs

```typescript
import { toColumnDefs, toFormConfig, toFilterConfig } from '@zodal/ui';

const columns = toColumnDefs(projects);       // ColumnConfig[]
const createForm = toFormConfig(projects, 'create');  // FormFieldConfig[]
const editForm = toFormConfig(projects, 'edit');       // FormFieldConfig[]
const filters = toFilterConfig(projects);     // FilterFieldConfig[]
```

### Step 4: Set up state management

**Option A: Zustand store** (recommended for React)
```typescript
import { create } from 'zustand';
import { createZustandStoreSlice } from '@zodal/ui';

const useProjectStore = create(
  createZustandStoreSlice(projects, provider)
);
```

**Option B: Pure functions** (framework-agnostic)
```typescript
import { createCollectionStore } from '@zodal/ui';

const store = createCollectionStore(projects);
let state = store.initialState;
// Use store.actions.* to update state
```

**Option C: Individual slices** (pick what you need)
```typescript
import { createSortingSlice, createFilterSlice, createPaginationSlice } from '@zodal/ui';

const sorting = createSortingSlice(projects);
const filtering = createFilterSlice(projects);
const pagination = createPaginationSlice(projects);
```

### Step 5: Set up the renderer registry

```typescript
import { createShadcnRegistry } from 'zodal-ui-shadcn';

const registry = createShadcnRegistry();

// Optionally add app-level overrides:
import { PRIORITY } from '@zodal/ui';
registry.register({
  tester: (field) => field.fieldName === 'priority' ? PRIORITY.APP : -1,
  renderer: PriorityStarsCell,  // your custom component
  name: 'PriorityStars (app override)',
});
```

### Step 6: Wire into TanStack Table

```typescript
import { useReactTable, getCoreRowModel, getSortedRowModel } from '@tanstack/react-table';

function ProjectsTable() {
  const { items, total, sorting, pagination, setSorting, setPagination, fetchData } = useProjectStore();

  // Convert zodal ColumnConfig[] to TanStack ColumnDef[]
  const tanstackColumns = columns.map(col => ({
    ...col,
    // Resolve cell renderer from registry
    cell: ({ getValue, row }) => {
      const field = projects.fieldAffordances[col.id];
      if (!field) return getValue();
      const CellComponent = registry.resolve(field, { mode: 'cell' });
      if (!CellComponent) return String(getValue() ?? '');
      return <CellComponent value={getValue()} config={col} row={row.original} />;
    },
  }));

  const table = useReactTable({
    data: items,
    columns: tanstackColumns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    manualSorting: provider.getCapabilities?.()?.serverSort === true,
    manualPagination: provider.getCapabilities?.()?.serverPagination === true,
    state: { sorting, pagination },
    onSortingChange: setSorting,
    onPaginationChange: setPagination,
    rowCount: total,
  });

  useEffect(() => { fetchData(); }, [sorting, pagination]);

  return <DataTable table={table} />;
}
```

### Step 7: Wire forms

```typescript
function CreateProjectForm() {
  const createForm = toFormConfig(projects, 'create');

  return (
    <form onSubmit={handleSubmit}>
      {createForm.map(fieldConfig => {
        const field = projects.fieldAffordances[fieldConfig.name];
        const FormComponent = registry.resolve(field, { mode: 'form' });
        if (!FormComponent) return null;
        return <FormComponent key={fieldConfig.name} config={fieldConfig} field={formField} />;
      })}
      <Button type="submit">Create</Button>
    </form>
  );
}
```

### Step 8: Wire filter panel

```typescript
function FilterPanel() {
  const filters = toFilterConfig(projects);
  const { setColumnFilter, clearFilters } = useProjectStore();

  return (
    <div className="flex gap-2">
      {filters.map(filterConfig => {
        const field = projects.fieldAffordances[filterConfig.name];
        const FilterComponent = registry.resolve(field, { mode: 'filter' });
        if (!FilterComponent) return null;
        return (
          <FilterComponent
            key={filterConfig.name}
            config={filterConfig}
            field={{ value: currentFilterValue, onChange: (v) => setColumnFilter(filterConfig.name, v) }}
          />
        );
      })}
      <Button variant="ghost" onClick={clearFilters}>Clear</Button>
    </div>
  );
}
```

## Capability-Aware UI

The provider's capabilities should drive UI decisions:

```typescript
const caps = provider.getCapabilities?.() ?? DEFAULT_CAPABILITIES;

// Only show "New" button if provider supports create
{caps.canCreate && <Button onClick={openCreateForm}>New Project</Button>}

// Only show bulk delete if provider + collection both support it
{caps.canBulkDelete && projects.affordances.bulkDelete && (
  <Button onClick={handleBulkDelete} disabled={selectedIds.length === 0}>
    Delete Selected
  </Button>
)}

// Use manual (server-side) sorting/pagination when available
const manualSorting = caps.serverSort !== false;
const manualPagination = caps.serverPagination;
```

## Search Integration

```typescript
function SearchBar() {
  const { setSearch, fetchData } = useProjectStore();
  const [query, setQuery] = useState('');

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(query);
      fetchData();
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  return (
    <Input
      placeholder="Search projects..."
      value={query}
      onChange={(e) => setQuery(e.target.value)}
    />
  );
}
```

## Putting It All Together

A typical collection page layout:

```typescript
function ProjectsPage() {
  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex justify-between">
        <SearchBar />
        <div className="flex gap-2">
          <FilterPanel />
          {caps.canCreate && <CreateButton />}
        </div>
      </div>

      {/* Table */}
      <ProjectsTable />

      {/* Pagination */}
      <PaginationControls />

      {/* Dialogs */}
      <CreateDialog />
      <EditDialog />
    </div>
  );
}
```

## Architecture Diagram

```
Schema (Zod) ──→ defineCollection() ──→ CollectionDefinition
                                            │
                    ┌───────────────────────┼───────────────────────┐
                    ▼                       ▼                       ▼
            toColumnDefs()          toFormConfig()          toFilterConfig()
                    │                       │                       │
                    ▼                       ▼                       ▼
            ColumnConfig[]         FormFieldConfig[]       FilterFieldConfig[]
                    │                       │                       │
                    └───────────┬───────────┘───────────────────────┘
                                │
                    RendererRegistry.resolve()
                                │
                                ▼
                    Concrete UI Components (shadcn, MUI, etc.)
                                │
                                ▼
                    React Page (TanStack Table + Zustand + DataProvider)
```

## Common Patterns

### Provider swap for testing
```typescript
// Production: real backend
const provider = createSupabaseProvider({ client: supabase, table: 'projects' });

// Testing: in-memory with same interface
const provider = createInMemoryProvider(mockData, { idField: 'id' });
```

### Optimistic updates
```typescript
const { update, fetchData } = useProjectStore();

async function handleInlineEdit(id: string, field: string, value: unknown) {
  // Optimistically update local state
  update(id, { [field]: value });
  try {
    await provider.update(id, { [field]: value });
  } catch {
    // Revert on failure
    fetchData();
  }
}
```

### Multiple collections on one page
```typescript
const projects = defineCollection(ProjectSchema);
const tasks = defineCollection(TaskSchema);

const useProjectStore = create(createZustandStoreSlice(projects, projectProvider));
const useTaskStore = create(createZustandStoreSlice(tasks, taskProvider));

// Cross-collection filtering
function ProjectTasksPage() {
  const selectedProject = useProjectStore(s => s.selectedItems[0]);
  const { setColumnFilter, fetchData } = useTaskStore();

  useEffect(() => {
    if (selectedProject) {
      setColumnFilter('projectId', selectedProject.id);
      fetchData();
    }
  }, [selectedProject]);
}
```

## Checklist

- [ ] Schema defined with `defineCollection()`
- [ ] DataProvider created for your backend
- [ ] UI configs generated (`toColumnDefs`, `toFormConfig`, `toFilterConfig`)
- [ ] State management wired (Zustand or pure)
- [ ] Renderer registry created and populated
- [ ] TanStack Table wired with manual sort/pagination flags based on capabilities
- [ ] Forms wired with registry-resolved components
- [ ] Filter panel wired with registry-resolved widgets
- [ ] Capability-aware UI (conditional buttons, server vs. client sort/filter)
- [ ] Search debounced and connected to store
