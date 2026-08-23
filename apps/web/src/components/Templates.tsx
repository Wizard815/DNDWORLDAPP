import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { FieldType, FieldVisibility, TemplateDto, TemplateFieldDef } from "@dndworldapp/schema";
import { ApiError, api } from "../api.ts";
import { IconPicker } from "./IconPicker.tsx";

const FIELD_TYPE_LABEL: Record<FieldType, string> = {
  text: "Text",
  longtext: "Long text",
  number: "Number",
  checkbox: "Checkbox",
  select: "Select",
  date: "Date",
  link: "Link to a page",
  section: "Section heading",
};

const VISIBILITY_LABEL: Record<FieldVisibility, string> = {
  public: "Public",
  members: "Players",
  dm: "DM only",
};

function newField(): TemplateFieldDef {
  return { key: "", type: "text", label: "", visibility: "members" };
}

/**
 * Field-definition templates — authored once per world, then assigned to
 * nodes to instantiate per-node field values (services/templates.ts). Save is
 * one whole-array call, same as how a template's field schema is edited as
 * one document rather than per-field endpoints.
 */
export function Templates({ worldId, onClose }: { worldId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: ["templates", worldId], queryFn: () => api.templates(worldId) });
  const templates = data?.templates ?? [];
  const [selectedId, setSelectedId] = useState<string | "new" | null>(null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["templates", worldId] });

  const create = useMutation({
    mutationFn: () => api.createTemplate(worldId, { name: "New template", fieldSchema: [], defaultBodyMd: "" }),
    onSuccess: (result) => {
      invalidate();
      setSelectedId(result.template.id);
    },
  });

  const remove = useMutation({
    mutationFn: (templateId: string) => api.deleteTemplate(worldId, templateId),
    onSuccess: () => {
      invalidate();
      setSelectedId(null);
    },
  });

  const selected = templates.find((t) => t.id === selectedId) ?? null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-[6vh]" onClick={onClose}>
      <div
        className="flex max-h-[86vh] w-full max-w-4xl overflow-hidden rounded-lg border border-[#33363d] bg-[#1d1f23] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-56 shrink-0 overflow-y-auto border-r border-[#2c2f36] p-3">
          <div className="mb-2 flex items-center">
            <h2 className="text-sm font-semibold text-[#f0f1f4]">Templates</h2>
            <button type="button" onClick={onClose} className="ml-auto text-xs text-[#7a7d86] hover:text-[#d7d8dc]">
              Close
            </button>
          </div>
          <ul className="space-y-0.5">
            {templates.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(t.id)}
                  className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm ${
                    selectedId === t.id ? "bg-[#2c2f36] text-[#f0f1f4]" : "text-[#b6b8bf] hover:bg-[#232529]"
                  }`}
                >
                  <span>{t.icon ?? "📋"}</span>
                  <span className="min-w-0 flex-1 truncate">{t.name}</span>
                </button>
              </li>
            ))}
            {templates.length === 0 && (
              <p className="px-2 py-2 text-xs text-[#6b6e77]">No templates yet.</p>
            )}
          </ul>
          <button
            type="button"
            onClick={() => create.mutate()}
            disabled={create.isPending}
            className="mt-2 w-full rounded px-2 py-1.5 text-left text-xs text-[#8d9099] hover:bg-[#232529] hover:text-[#d7d8dc] disabled:opacity-50"
          >
            + New template
          </button>
        </div>

        <div className="min-w-0 flex-1 overflow-y-auto p-5">
          {selected === null ? (
            <p className="text-sm text-[#7a7d86]">Pick a template on the left, or create one.</p>
          ) : (
            <TemplateEditor
              key={selected.id}
              worldId={worldId}
              template={selected}
              onSaved={invalidate}
              onDelete={() => {
                if (window.confirm(`Delete "${selected.name}"? Pages using it keep their field values.`)) {
                  remove.mutate(selected.id);
                }
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function TemplateEditor({
  worldId,
  template,
  onSaved,
  onDelete,
}: {
  worldId: string;
  template: TemplateDto;
  onSaved: () => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(template.name);
  const [icon, setIcon] = useState(template.icon);
  const [fields, setFields] = useState<TemplateFieldDef[]>(template.fieldSchema);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () =>
      api.updateTemplate(worldId, template.id, { name, icon, fieldSchema: fields, defaultBodyMd: template.defaultBodyMd }),
    onSuccess: () => {
      setError(null);
      onSaved();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Could not save the template."),
  });

  function updateField(index: number, patch: Partial<TemplateFieldDef>): void {
    setFields((prev) => prev.map((f, i) => (i === index ? { ...f, ...patch } : f)));
  }

  function moveField(index: number, dir: -1 | 1): void {
    setFields((prev) => {
      const next = [...prev];
      const target = index + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  }

  function removeField(index: number): void {
    setFields((prev) => prev.filter((_, i) => i !== index));
  }

  return (
    <div>
      <div className="mb-4 flex items-center gap-2">
        <IconPicker value={icon} disabled={false} onChange={setIcon} />
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="min-w-0 flex-1 rounded-md border border-[#33363d] bg-[#17181b] px-2 py-1.5 text-lg font-semibold text-[#f0f1f4] outline-none focus:border-[#4a4d55]"
        />
        <button
          type="button"
          onClick={onDelete}
          className="shrink-0 rounded-md border border-[#33363d] px-2.5 py-1.5 text-xs text-[#c98b8b] hover:bg-[#26282e]"
        >
          Delete
        </button>
      </div>

      <ul className="mb-3 space-y-2">
        {fields.map((field, index) => (
          <li key={index} className="rounded-md border border-[#2c2f36] p-3">
            <div className="flex items-center gap-2">
              <div className="flex shrink-0 flex-col">
                <button
                  type="button"
                  onClick={() => moveField(index, -1)}
                  disabled={index === 0}
                  className="text-[10px] text-[#7a7d86] hover:text-[#d7d8dc] disabled:opacity-30"
                  aria-label="Move up"
                >
                  ▲
                </button>
                <button
                  type="button"
                  onClick={() => moveField(index, 1)}
                  disabled={index === fields.length - 1}
                  className="text-[10px] text-[#7a7d86] hover:text-[#d7d8dc] disabled:opacity-30"
                  aria-label="Move down"
                >
                  ▼
                </button>
              </div>
              <input
                value={field.key}
                onChange={(e) => updateField(index, { key: e.target.value })}
                placeholder="key"
                className="w-28 shrink-0 rounded border border-[#33363d] bg-[#17181b] px-2 py-1 font-mono text-xs text-[#d7d8dc] outline-none focus:border-[#4a4d55]"
              />
              <input
                value={field.label}
                onChange={(e) => updateField(index, { label: e.target.value })}
                placeholder="Label"
                className="min-w-0 flex-1 rounded border border-[#33363d] bg-[#17181b] px-2 py-1 text-sm text-[#d7d8dc] outline-none focus:border-[#4a4d55]"
              />
              <select
                value={field.type}
                onChange={(e) => updateField(index, { type: e.target.value as FieldType })}
                className="shrink-0 rounded border border-[#33363d] bg-[#17181b] px-2 py-1 text-xs text-[#d7d8dc]"
              >
                {(Object.keys(FIELD_TYPE_LABEL) as FieldType[]).map((t) => (
                  <option key={t} value={t}>
                    {FIELD_TYPE_LABEL[t]}
                  </option>
                ))}
              </select>
              <select
                value={field.visibility}
                onChange={(e) => updateField(index, { visibility: e.target.value as FieldVisibility })}
                className="shrink-0 rounded border border-[#33363d] bg-[#17181b] px-2 py-1 text-xs text-[#d7d8dc]"
              >
                {(Object.keys(VISIBILITY_LABEL) as FieldVisibility[]).map((v) => (
                  <option key={v} value={v}>
                    {VISIBILITY_LABEL[v]}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => removeField(index)}
                className="shrink-0 text-xs text-[#7a7d86] hover:text-[#e0888a]"
              >
                Remove
              </button>
            </div>
            {field.type === "select" && (
              <textarea
                value={(field.options ?? []).join("\n")}
                onChange={(e) =>
                  updateField(index, {
                    options: e.target.value.split("\n").map((s) => s.trim()).filter((s) => s.length > 0),
                  })
                }
                placeholder="One option per line"
                rows={3}
                className="mt-2 w-full rounded border border-[#33363d] bg-[#17181b] px-2 py-1.5 text-xs text-[#d7d8dc] outline-none focus:border-[#4a4d55]"
              />
            )}
          </li>
        ))}
        {fields.length === 0 && (
          <p className="rounded-md border border-dashed border-[#2c2f36] px-3 py-4 text-center text-xs text-[#6b6e77]">
            No fields yet.
          </p>
        )}
      </ul>

      <button
        type="button"
        onClick={() => setFields((prev) => [...prev, newField()])}
        className="mb-4 rounded px-2 py-1.5 text-xs text-[#7a7d86] hover:bg-[#232529] hover:text-[#d7d8dc]"
      >
        + Add field
      </button>

      {error !== null && <p className="mb-2 text-xs text-[#e0888a]">{error}</p>}

      <div>
        <button
          type="button"
          onClick={() => save.mutate()}
          disabled={save.isPending}
          className="rounded-md bg-[#3d5ab5] px-3 py-1.5 text-sm text-white hover:bg-[#4867cc] disabled:opacity-50"
        >
          {save.isPending ? "Saving…" : "Save template"}
        </button>
      </div>
    </div>
  );
}
