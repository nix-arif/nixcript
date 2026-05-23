"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  getSuppliers,
  createSupplier,
  updateSupplier,
  deleteSupplier,
  type Supplier,
} from "@/server/supplier";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { PageHeader } from "@/components/page-header";
import { Highlight } from "@/components/highlight";
import {
  PlusIcon,
  SearchIcon,
  PencilIcon,
  TrashIcon,
  XIcon,
  BuildingIcon,
  PhoneIcon,
  MailIcon,
  UserIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  initialSuppliers: Supplier[];
}

const EMPTY_FORM = {
  name: "",
  registrationNo: "",
  address: "",
  contactPerson: "",
  contactNo: "",
  email: "",
  notes: "",
};

export function SupplierClient({ initialSuppliers }: Props) {
  const [suppliers, setSuppliers] = useState(initialSuppliers);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const filtered = suppliers.filter(
    (s) =>
      !search ||
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.registrationNo?.toLowerCase().includes(search.toLowerCase()) ||
      s.contactPerson?.toLowerCase().includes(search.toLowerCase()),
  );

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setOpen(true);
  }

  function openEdit(s: Supplier) {
    setEditing(s);
    setForm({
      name: s.name,
      registrationNo: s.registrationNo ?? "",
      address: s.address ?? "",
      contactPerson: s.contactPerson ?? "",
      contactNo: s.contactNo ?? "",
      email: s.email ?? "",
      notes: s.notes ?? "",
    });
    setOpen(true);
  }

  const f = (k: keyof typeof EMPTY_FORM) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((prev) => ({ ...prev, [k]: e.target.value }));

  async function handleSave() {
    if (!form.name.trim()) { toast.error("Supplier name is required"); return; }
    setSaving(true);
    try {
      if (editing) {
        await updateSupplier({ id: editing.id, ...form });
        toast.success("Supplier updated");
      } else {
        await createSupplier(form);
        toast.success("Supplier created");
      }
      setSuppliers(await getSuppliers());
      setOpen(false);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
    setDeleting(id);
    try {
      await deleteSupplier(id);
      setSuppliers(await getSuppliers());
      toast.success("Supplier deleted");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div className="p-6">
      <PageHeader
        title="Suppliers"
        description="Manage your supplier contacts"
        action={
          <Button onClick={openCreate} className="gap-2">
            <PlusIcon className="w-4 h-4" /> Add supplier
          </Button>
        }
      />

      <div className="relative mb-4">
        <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, reg no., contact..."
          className="pl-9 h-9 text-sm"
        />
        {search && (
          <button
            onClick={() => setSearch("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          >
            <XIcon className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      <div className="text-xs text-muted-foreground mb-3 tabular-nums">
        {filtered.length} supplier{filtered.length !== 1 ? "s" : ""}
      </div>

      {filtered.length === 0 ? (
        <div className="border border-border rounded-xl py-16 text-center text-muted-foreground">
          <BuildingIcon className="w-8 h-8 mx-auto mb-3 opacity-30" />
          <div className="text-sm font-medium mb-1">No suppliers yet</div>
          <div className="text-xs mb-4">Add your first supplier to get started</div>
          <Button variant="outline" size="sm" className="gap-2" onClick={openCreate}>
            <PlusIcon className="w-3.5 h-3.5" /> Add supplier
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((s) => (
            <div
              key={s.id}
              className="border border-border rounded-xl bg-background px-4 py-3 flex items-start gap-3 hover:bg-muted/20 transition-colors"
            >
              <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-muted/40 shrink-0 mt-0.5">
                <BuildingIcon className="w-3.5 h-3.5 text-muted-foreground" />
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-sm">
                    <Highlight text={s.name} query={search} />
                  </span>
                  {s.registrationNo && (
                    <span className="text-[11px] text-muted-foreground bg-muted/50 rounded px-1.5 py-0.5 font-mono">
                      <Highlight text={s.registrationNo} query={search} />
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-4 mt-1 flex-wrap">
                  {s.contactPerson && (
                    <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                      <UserIcon className="w-3 h-3" />
                      <Highlight text={s.contactPerson} query={search} />
                    </span>
                  )}
                  {s.contactNo && (
                    <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                      <PhoneIcon className="w-3 h-3" /> {s.contactNo}
                    </span>
                  )}
                  {s.email && (
                    <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                      <MailIcon className="w-3 h-3" /> {s.email}
                    </span>
                  )}
                </div>
                {s.address && (
                  <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{s.address}</p>
                )}
              </div>

              <div className="flex items-center gap-1 shrink-0">
                <Button
                  variant="ghost"
                  size="icon"
                  className="w-7 h-7"
                  onClick={() => openEdit(s)}
                >
                  <PencilIcon className="w-3.5 h-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="w-7 h-7 text-destructive hover:text-destructive"
                  disabled={deleting === s.id}
                  onClick={() => handleDelete(s.id, s.name)}
                >
                  <TrashIcon className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader className="mb-5">
            <SheetTitle>{editing ? "Edit supplier" : "Add supplier"}</SheetTitle>
          </SheetHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Company name <span className="text-destructive">*</span></Label>
              <Input value={form.name} onChange={f("name")} placeholder="e.g. ABC Medical Sdn Bhd" />
            </div>
            <div className="space-y-1.5">
              <Label>Registration no.</Label>
              <Input value={form.registrationNo} onChange={f("registrationNo")} placeholder="e.g. 202201012345" />
            </div>
            <div className="space-y-1.5">
              <Label>Address</Label>
              <Textarea value={form.address} onChange={f("address")} placeholder="Company address" rows={3} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Contact person</Label>
                <Input value={form.contactPerson} onChange={f("contactPerson")} placeholder="Name" />
              </div>
              <div className="space-y-1.5">
                <Label>Phone</Label>
                <Input value={form.contactNo} onChange={f("contactNo")} placeholder="e.g. 012-3456789" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input type="email" value={form.email} onChange={f("email")} placeholder="supplier@example.com" />
            </div>
            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Textarea value={form.notes} onChange={f("notes")} placeholder="Internal notes..." rows={2} />
            </div>

            <div className="flex gap-2 pt-2">
              <Button className="flex-1" onClick={handleSave} disabled={saving}>
                {saving ? "Saving…" : editing ? "Save changes" : "Add supplier"}
              </Button>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
