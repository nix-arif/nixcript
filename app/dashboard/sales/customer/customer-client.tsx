"use client";

import { useState, useCallback } from "react";
import { toast } from "sonner";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  createCustomer,
  updateCustomer,
  deleteCustomer,
  getCustomers,
  addCustomerCompany,
  updateCustomerCompany,
  deleteCustomerCompany,
  type CustomerCompany,
} from "@/server/customer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/page-header";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  PlusIcon,
  SearchIcon,
  PencilIcon,
  EyeIcon,
  TrashIcon,
  XIcon,
  BuildingIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  StarIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Customer = Awaited<ReturnType<typeof getCustomers>>[number];

const TITLES = [
  "Dr",
  "Matron",
  "Sr",
  "Mr",
  "Ms",
  "Mdm",
  "Prof",
  "Dato",
  "Datin",
  "Tan Sri",
];

const AVATAR_COLORS = [
  "bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400",
  "bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400",
  "bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400",
  "bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-400",
  "bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400",
  "bg-teal-50 dark:bg-teal-900/30 text-teal-700 dark:text-teal-400",
];

function getAvatarColor(name: string) {
  return AVATAR_COLORS[name.charCodeAt(0) % AVATAR_COLORS.length];
}

function getInitials(name: string) {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

// Personal info schema only — company affiliations managed separately
const schema = z.object({
  title: z.string().optional(),
  name: z.string().min(1, "Name is required"),
  contactNo: z.string().optional(),
  email: z.string().email("Invalid email").optional().or(z.literal("")),
});
type FormValues = z.infer<typeof schema>;

const companySchema = z.object({
  organizationName: z.string().optional(),
  organizationAddress: z.string().optional(),
  position: z.string().optional(),
  department: z.string().optional(),
});
type CompanyFormValues = z.infer<typeof companySchema>;

function Field({
  label,
  error,
  children,
  className,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label className="block text-xs font-medium text-muted-foreground">
        {label}
      </label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

// Inline company entry form (for create flow)
function CompanyEntry({
  value,
  onChange,
  onRemove,
  isPrimary,
  onSetPrimary,
}: {
  value: CompanyFormValues;
  onChange: (v: CompanyFormValues) => void;
  onRemove: () => void;
  isPrimary: boolean;
  onSetPrimary: () => void;
}) {
  const [expanded, setExpanded] = useState(true);
  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 bg-muted/20">
        <button
          type="button"
          className="flex items-center gap-2 text-xs font-medium flex-1 text-left"
          onClick={() => setExpanded(!expanded)}
        >
          <BuildingIcon className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="truncate">
            {value.organizationName || "New company"}
          </span>
          {isPrimary && (
            <span className="text-[10px] bg-primary/10 text-primary rounded px-1.5 py-0.5 ml-1">
              Primary
            </span>
          )}
          {expanded ? (
            <ChevronUpIcon className="w-3.5 h-3.5 ml-auto text-muted-foreground" />
          ) : (
            <ChevronDownIcon className="w-3.5 h-3.5 ml-auto text-muted-foreground" />
          )}
        </button>
        <div className="flex items-center gap-1 ml-2">
          {!isPrimary && (
            <button
              type="button"
              onClick={onSetPrimary}
              title="Set as primary"
              className="p-1 text-muted-foreground hover:text-amber-500 transition-colors"
            >
              <StarIcon className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={onRemove}
            className="p-1 text-muted-foreground hover:text-destructive transition-colors"
          >
            <XIcon className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      {expanded && (
        <div className="p-3 space-y-3">
          <Field label="Organization name">
            <Input
              value={value.organizationName ?? ""}
              onChange={(e) =>
                onChange({ ...value, organizationName: e.target.value })
              }
              placeholder="e.g. Hospital Kuala Lumpur"
              className="h-9 text-sm"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Position / job title">
              <Input
                value={value.position ?? ""}
                onChange={(e) =>
                  onChange({ ...value, position: e.target.value })
                }
                placeholder="e.g. Procurement Officer"
                className="h-9 text-sm"
              />
            </Field>
            <Field label="Department">
              <Input
                value={value.department ?? ""}
                onChange={(e) =>
                  onChange({ ...value, department: e.target.value })
                }
                placeholder="e.g. Surgery"
                className="h-9 text-sm"
              />
            </Field>
          </div>
          <Field label="Organization address">
            <Textarea
              value={value.organizationAddress ?? ""}
              onChange={(e) =>
                onChange({ ...value, organizationAddress: e.target.value })
              }
              placeholder="Full address"
              rows={2}
              className="text-sm resize-none"
            />
          </Field>
        </div>
      )}
    </div>
  );
}

interface Props {
  initialCustomers: Customer[];
  canEdit: boolean;
}

export function CustomerClient({ initialCustomers, canEdit }: Props) {
  const [customers, setCustomers] = useState(initialCustomers);
  const [search, setSearch] = useState("");
  const [searching, setSearching] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editCustomer, setEditCustomer] = useState<Customer | null>(null);
  const [viewCustomer, setViewCustomer] = useState<Customer | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const PER_PAGE = 10;

  // New-customer company entries
  const [localCompanies, setLocalCompanies] = useState<
    (CompanyFormValues & { isPrimary: boolean })[]
  >([]);

  // Edit-customer: company being added inline
  const [addingCompany, setAddingCompany] = useState(false);
  const [newCompanyForm, setNewCompanyForm] = useState<CompanyFormValues>({});
  const [editingCompanyId, setEditingCompanyId] = useState<string | null>(null);
  const [editingCompanyForm, setEditingCompanyForm] =
    useState<CompanyFormValues>({});
  const [savingCompany, setSavingCompany] = useState(false);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  const refreshCustomers = useCallback(async (q?: string) => {
    const rows = await getCustomers(q);
    setCustomers(rows);
  }, []);

  const handleSearch = async (q: string) => {
    setSearch(q);
    setPage(1);
    setSearching(true);
    try {
      await refreshCustomers(q);
    } finally {
      setSearching(false);
    }
  };

  const openCreate = () => {
    (document.activeElement as HTMLElement)?.blur();
    reset({ title: "", name: "", contactNo: "", email: "" });
    setLocalCompanies([]);
    setEditCustomer(null);
    setViewCustomer(null);
    setSheetOpen(true);
  };

  const openEdit = (c: Customer) => {
    (document.activeElement as HTMLElement)?.blur();
    reset({
      title: c.title ?? "",
      name: c.name,
      contactNo: c.contactNo ?? "",
      email: c.email ?? "",
    });
    setEditCustomer(c);
    setViewCustomer(null);
    setAddingCompany(false);
    setEditingCompanyId(null);
    setSheetOpen(true);
  };

  const openView = (c: Customer) => {
    (document.activeElement as HTMLElement)?.blur();
    setViewCustomer(c);
    setEditCustomer(null);
    setSheetOpen(true);
  };

  const closeSheet = () => {
    setSheetOpen(false);
    setEditCustomer(null);
    setViewCustomer(null);
    setAddingCompany(false);
    setEditingCompanyId(null);
  };

  const onSubmit = async (data: FormValues) => {
    setSaving(true);
    try {
      if (editCustomer) {
        await updateCustomer(editCustomer.id, data);
        toast.success("Customer updated");
      } else {
        await createCustomer({
          ...data,
          companies: localCompanies.map((c) => ({
            organizationName: c.organizationName,
            organizationAddress: c.organizationAddress,
            position: c.position,
            department: c.department,
            isPrimary: c.isPrimary,
          })),
        });
        toast.success("Customer created");
      }
      await refreshCustomers(search);
      closeSheet();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this customer? This cannot be undone.")) return;
    setDeleting(id);
    try {
      await deleteCustomer(id);
      toast.success("Customer deleted");
      await refreshCustomers(search);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setDeleting(null);
    }
  };

  // ── Company management for existing customer (edit mode) ─────────────────

  const handleSaveNewCompany = async () => {
    if (!editCustomer) return;
    setSavingCompany(true);
    try {
      await addCustomerCompany(editCustomer.id, {
        ...newCompanyForm,
        isPrimary: editCustomer.companies.length === 0,
      });
      toast.success("Company added");
      setAddingCompany(false);
      setNewCompanyForm({});
      const rows = await getCustomers(search);
      setCustomers(rows);
      const updated = rows.find((r) => r.id === editCustomer.id);
      if (updated) setEditCustomer(updated);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSavingCompany(false);
    }
  };

  const handleUpdateCompany = async (companyId: string) => {
    setSavingCompany(true);
    try {
      await updateCustomerCompany(companyId, editingCompanyForm);
      toast.success("Company updated");
      setEditingCompanyId(null);
      const rows = await getCustomers(search);
      setCustomers(rows);
      const updated = rows.find((r) => r.id === editCustomer?.id);
      if (updated) setEditCustomer(updated);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSavingCompany(false);
    }
  };

  const handleDeleteCompany = async (companyId: string) => {
    if (!confirm("Remove this company affiliation?")) return;
    try {
      await deleteCustomerCompany(companyId);
      toast.success("Company removed");
      const rows = await getCustomers(search);
      setCustomers(rows);
      const updated = rows.find((r) => r.id === editCustomer?.id);
      if (updated) setEditCustomer(updated);
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const handleSetPrimary = async (companyId: string) => {
    try {
      await updateCustomerCompany(companyId, { isPrimary: true });
      const rows = await getCustomers(search);
      setCustomers(rows);
      const updated = rows.find((r) => r.id === editCustomer?.id);
      if (updated) setEditCustomer(updated);
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const totalPages = Math.ceil(customers.length / PER_PAGE);
  const paginated = customers.slice((page - 1) * PER_PAGE, page * PER_PAGE);
  const isReadOnly = !!viewCustomer && !editCustomer;

  return (
    <div className="p-6">
      <PageHeader
        title="Customers"
        description="Manage your customer database"
        action={
          canEdit ? (
            <Button onClick={openCreate} className="gap-2">
              <PlusIcon className="w-4 h-4" /> New customer
            </Button>
          ) : undefined
        }
      />

      {/* Search */}
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1">
          <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="Search by name, email, contact..."
            className="pl-9 h-9 text-sm"
          />
          {search && (
            <button
              onClick={() => handleSearch("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <XIcon className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        <div className="text-xs text-muted-foreground whitespace-nowrap">
          {searching
            ? "Searching…"
            : `${customers.length} customer${customers.length !== 1 ? "s" : ""}`}
        </div>
      </div>

      {/* Table */}
      <div className="bg-background border border-border rounded-xl overflow-hidden mb-4">
        <div className="grid grid-cols-[2fr_2fr_1.5fr_1fr_80px] px-4 py-2.5 bg-muted/20 border-b border-border">
          {["Customer", "Primary company", "Position", "Contact", ""].map(
            (h) => (
              <div
                key={h}
                className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground"
              >
                {h}
              </div>
            ),
          )}
        </div>

        {paginated.length === 0 ? (
          <div className="py-16 text-center text-muted-foreground">
            <div className="text-sm font-medium mb-1">No customers found</div>
            <div className="text-xs mb-4">
              {search
                ? "Try a different search term"
                : "Add your first customer to get started"}
            </div>
            {canEdit && !search && (
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={openCreate}
              >
                <PlusIcon className="w-3.5 h-3.5" /> New customer
              </Button>
            )}
          </div>
        ) : (
          paginated.map((c, i) => {
            const primary =
              c.companies.find((co) => co.isPrimary) ?? c.companies[0] ?? null;
            return (
              <div
                key={c.id}
                className={cn(
                  "grid grid-cols-[2fr_2fr_1.5fr_1fr_80px] px-4 py-3 items-center",
                  i < paginated.length - 1 ? "border-b border-border" : "",
                  i % 2 === 1 ? "bg-muted/10" : "",
                )}
              >
                {/* Customer */}
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className={cn(
                      "w-8 h-8 rounded-lg flex items-center justify-center text-xs font-medium shrink-0",
                      getAvatarColor(c.name),
                    )}
                  >
                    {getInitials(c.name)}
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">
                      {[c.title, c.name].filter(Boolean).join(" ")}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {c.companies.length > 0
                        ? `${c.companies.length} company${c.companies.length !== 1 ? " affiliations" : " affiliation"}`
                        : "No company"}
                    </div>
                  </div>
                </div>

                {/* Primary company */}
                <div className="min-w-0 pr-3">
                  <div className="text-sm truncate">
                    {primary?.organizationName ?? "—"}
                  </div>
                  <div className="text-[11px] text-muted-foreground truncate">
                    {primary?.department ?? ""}
                  </div>
                </div>

                {/* Position */}
                <div className="text-sm text-muted-foreground truncate pr-2">
                  {primary?.position ?? "—"}
                </div>

                {/* Contact */}
                <div className="text-sm text-muted-foreground truncate">
                  {c.contactNo ?? c.email ?? "—"}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 justify-end">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 text-muted-foreground"
                    onClick={() => openView(c)}
                  >
                    <EyeIcon className="w-3.5 h-3.5" />
                  </Button>
                  {canEdit && (
                    <>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 text-muted-foreground"
                        onClick={() => openEdit(c)}
                      >
                        <PencilIcon className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                        disabled={deleting === c.id}
                        onClick={() => handleDelete(c.id)}
                      >
                        {deleting === c.id ? (
                          <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                        ) : (
                          <TrashIcon className="w-3.5 h-3.5" />
                        )}
                      </Button>
                    </>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <div className="text-xs text-muted-foreground">
            Showing {(page - 1) * PER_PAGE + 1}–
            {Math.min(page * PER_PAGE, customers.length)} of {customers.length}
          </div>
          <div className="flex gap-1">
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              disabled={page === 1}
              onClick={() => setPage(page - 1)}
            >
              Previous
            </Button>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
              <Button
                key={p}
                variant={p === page ? "default" : "outline"}
                size="sm"
                className="h-7 w-7 p-0 text-xs"
                onClick={() => setPage(p)}
              >
                {p}
              </Button>
            ))}
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              disabled={page === totalPages}
              onClick={() => setPage(page + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      {/* Sheet */}
      <Sheet open={sheetOpen} onOpenChange={closeSheet}>
        <SheetContent className="w-full max-w-lg! overflow-y-auto px-10" aria-describedby={undefined}>
          <SheetHeader className="mb-5">
            <SheetTitle>
              {isReadOnly
                ? "Customer details"
                : editCustomer
                  ? "Edit customer"
                  : "New customer"}
            </SheetTitle>
          </SheetHeader>

          {isReadOnly && viewCustomer ? (
            /* ── View mode ──────────────────────────────────────── */
            <div className="space-y-1">
              <div className="flex items-center gap-4 p-4 bg-muted/30 rounded-lg mb-4">
                <div
                  className={cn(
                    "w-12 h-12 rounded-lg flex items-center justify-center text-base font-medium shrink-0",
                    getAvatarColor(viewCustomer.name),
                  )}
                >
                  {getInitials(viewCustomer.name)}
                </div>
                <div>
                  <div className="font-semibold">
                    {[viewCustomer.title, viewCustomer.name]
                      .filter(Boolean)
                      .join(" ")}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {viewCustomer.companies.length} company affiliation
                    {viewCustomer.companies.length !== 1 ? "s" : ""}
                  </div>
                </div>
              </div>

              {[
                { label: "Contact no.", value: viewCustomer.contactNo },
                { label: "Email", value: viewCustomer.email },
                { label: "Added by", value: viewCustomer.createdByName },
                {
                  label: "Added on",
                  value: viewCustomer.createdAt
                    ? new Date(viewCustomer.createdAt).toLocaleDateString(
                        "en-MY",
                        { day: "2-digit", month: "long", year: "numeric" },
                      )
                    : null,
                },
              ].map((f) =>
                f.value ? (
                  <div
                    key={f.label}
                    className="flex justify-between py-2.5 border-b border-border text-sm"
                  >
                    <span className="text-muted-foreground">{f.label}</span>
                    <span className="font-medium text-right max-w-xs">
                      {f.value}
                    </span>
                  </div>
                ) : null,
              )}

              {/* Company affiliations */}
              {viewCustomer.companies.length > 0 && (
                <div className="pt-4">
                  <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
                    Company affiliations
                  </div>
                  <div className="space-y-3">
                    {viewCustomer.companies.map((co) => (
                      <div
                        key={co.id}
                        className="border border-border rounded-lg p-3"
                      >
                        <div className="flex items-center gap-2 mb-2">
                          <BuildingIcon className="w-3.5 h-3.5 text-muted-foreground" />
                          <span className="text-sm font-medium">
                            {co.organizationName ?? "—"}
                          </span>
                          {co.isPrimary && (
                            <span className="text-[10px] bg-primary/10 text-primary rounded px-1.5 py-0.5">
                              Primary
                            </span>
                          )}
                        </div>
                        {[
                          { label: "Position", value: co.position },
                          { label: "Department", value: co.department },
                          {
                            label: "Address",
                            value: co.organizationAddress,
                          },
                        ].map((f) =>
                          f.value ? (
                            <div
                              key={f.label}
                              className="flex gap-2 text-xs text-muted-foreground"
                            >
                              <span className="w-20 shrink-0">{f.label}</span>
                              <span>{f.value}</span>
                            </div>
                          ) : null,
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* ── Create / Edit form ─────────────────────────────── */
            <div className="space-y-5">
              <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                {/* Title + Name */}
                <div className="grid grid-cols-[100px_1fr] gap-3">
                  <Field label="Title">
                    <Select
                      onValueChange={(v) => setValue("title", v)}
                      defaultValue={watch("title")}
                    >
                      <SelectTrigger className="h-9 text-sm">
                        <SelectValue placeholder="Title" />
                      </SelectTrigger>
                      <SelectContent>
                        {TITLES.map((t) => (
                          <SelectItem key={t} value={t}>
                            {t}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="Full name" error={errors.name?.message}>
                    <Input
                      {...register("name")}
                      placeholder="e.g. Ahmad Hafizi"
                      className="h-9 text-sm"
                    />
                  </Field>
                </div>

                {/* Contact + Email */}
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Contact no.">
                    <Input
                      {...register("contactNo")}
                      placeholder="+60 12 345 6789"
                      className="h-9 text-sm"
                    />
                  </Field>
                  <Field label="Email" error={errors.email?.message}>
                    <Input
                      type="email"
                      {...register("email")}
                      placeholder="contact@hospital.com"
                      className="h-9 text-sm"
                    />
                  </Field>
                </div>

                {/* Footer */}
                <div className="flex gap-2 pt-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="flex-1"
                    onClick={closeSheet}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={saving}
                    className="flex-1 gap-2"
                  >
                    {saving && (
                      <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                    )}
                    {editCustomer ? "Update" : "Create customer"}
                  </Button>
                </div>
              </form>

              {/* ── Company affiliations section ─────────────────── */}
              <div className="border-t border-border pt-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Company affiliations
                  </div>
                  {canEdit && !editCustomer && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs gap-1"
                      onClick={() =>
                        setLocalCompanies([
                          ...localCompanies,
                          { isPrimary: localCompanies.length === 0 },
                        ])
                      }
                    >
                      <PlusIcon className="w-3 h-3" /> Add company
                    </Button>
                  )}
                  {canEdit && editCustomer && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs gap-1"
                      onClick={() => {
                        setAddingCompany(true);
                        setNewCompanyForm({});
                      }}
                    >
                      <PlusIcon className="w-3 h-3" /> Add company
                    </Button>
                  )}
                </div>

                {/* New customer — inline company entries */}
                {!editCustomer && localCompanies.length > 0 && (
                  <div className="space-y-2">
                    {localCompanies.map((co, i) => (
                      <CompanyEntry
                        key={i}
                        value={co}
                        onChange={(v) =>
                          setLocalCompanies(
                            localCompanies.map((x, j) =>
                              j === i ? { ...v, isPrimary: x.isPrimary } : x,
                            ),
                          )
                        }
                        onRemove={() =>
                          setLocalCompanies(localCompanies.filter((_, j) => j !== i))
                        }
                        isPrimary={co.isPrimary}
                        onSetPrimary={() =>
                          setLocalCompanies(
                            localCompanies.map((x, j) => ({
                              ...x,
                              isPrimary: j === i,
                            })),
                          )
                        }
                      />
                    ))}
                  </div>
                )}

                {/* Edit customer — existing companies */}
                {editCustomer && (
                  <div className="space-y-2">
                    {editCustomer.companies.map((co) => (
                      <div
                        key={co.id}
                        className="border border-border rounded-lg overflow-hidden"
                      >
                        {editingCompanyId === co.id ? (
                          <div className="p-3 space-y-3">
                            <Field label="Organization name">
                              <Input
                                value={editingCompanyForm.organizationName ?? ""}
                                onChange={(e) =>
                                  setEditingCompanyForm({
                                    ...editingCompanyForm,
                                    organizationName: e.target.value,
                                  })
                                }
                                className="h-9 text-sm"
                              />
                            </Field>
                            <div className="grid grid-cols-2 gap-3">
                              <Field label="Position">
                                <Input
                                  value={editingCompanyForm.position ?? ""}
                                  onChange={(e) =>
                                    setEditingCompanyForm({
                                      ...editingCompanyForm,
                                      position: e.target.value,
                                    })
                                  }
                                  className="h-9 text-sm"
                                />
                              </Field>
                              <Field label="Department">
                                <Input
                                  value={editingCompanyForm.department ?? ""}
                                  onChange={(e) =>
                                    setEditingCompanyForm({
                                      ...editingCompanyForm,
                                      department: e.target.value,
                                    })
                                  }
                                  className="h-9 text-sm"
                                />
                              </Field>
                            </div>
                            <Field label="Address">
                              <Textarea
                                value={
                                  editingCompanyForm.organizationAddress ?? ""
                                }
                                onChange={(e) =>
                                  setEditingCompanyForm({
                                    ...editingCompanyForm,
                                    organizationAddress: e.target.value,
                                  })
                                }
                                rows={2}
                                className="text-sm resize-none"
                              />
                            </Field>
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                className="flex-1 h-8 text-xs"
                                disabled={savingCompany}
                                onClick={() => handleUpdateCompany(co.id)}
                              >
                                Save
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-8 text-xs"
                                onClick={() => setEditingCompanyId(null)}
                              >
                                Cancel
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-start justify-between p-3">
                            <div className="flex items-start gap-2 min-w-0">
                              <BuildingIcon className="w-3.5 h-3.5 text-muted-foreground mt-0.5 shrink-0" />
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-sm font-medium truncate">
                                    {co.organizationName ?? "—"}
                                  </span>
                                  {co.isPrimary && (
                                    <span className="text-[10px] bg-primary/10 text-primary rounded px-1.5 py-0.5 shrink-0">
                                      Primary
                                    </span>
                                  )}
                                </div>
                                {(co.position || co.department) && (
                                  <div className="text-xs text-muted-foreground">
                                    {[co.position, co.department]
                                      .filter(Boolean)
                                      .join(" · ")}
                                  </div>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-1 shrink-0 ml-2">
                              {!co.isPrimary && (
                                <button
                                  type="button"
                                  title="Set as primary"
                                  onClick={() => handleSetPrimary(co.id)}
                                  className="p-1 text-muted-foreground hover:text-amber-500 transition-colors"
                                >
                                  <StarIcon className="w-3.5 h-3.5" />
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingCompanyId(co.id);
                                  setEditingCompanyForm({
                                    organizationName: co.organizationName ?? "",
                                    organizationAddress:
                                      co.organizationAddress ?? "",
                                    position: co.position ?? "",
                                    department: co.department ?? "",
                                  });
                                }}
                                className="p-1 text-muted-foreground hover:text-foreground transition-colors"
                              >
                                <PencilIcon className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteCompany(co.id)}
                                className="p-1 text-muted-foreground hover:text-destructive transition-colors"
                              >
                                <XIcon className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}

                    {/* Add new company form (edit mode) */}
                    {addingCompany && (
                      <div className="border border-border rounded-lg p-3 space-y-3">
                        <Field label="Organization name">
                          <Input
                            value={newCompanyForm.organizationName ?? ""}
                            onChange={(e) =>
                              setNewCompanyForm({
                                ...newCompanyForm,
                                organizationName: e.target.value,
                              })
                            }
                            placeholder="e.g. Hospital Kuala Lumpur"
                            className="h-9 text-sm"
                          />
                        </Field>
                        <div className="grid grid-cols-2 gap-3">
                          <Field label="Position">
                            <Input
                              value={newCompanyForm.position ?? ""}
                              onChange={(e) =>
                                setNewCompanyForm({
                                  ...newCompanyForm,
                                  position: e.target.value,
                                })
                              }
                              placeholder="e.g. Manager"
                              className="h-9 text-sm"
                            />
                          </Field>
                          <Field label="Department">
                            <Input
                              value={newCompanyForm.department ?? ""}
                              onChange={(e) =>
                                setNewCompanyForm({
                                  ...newCompanyForm,
                                  department: e.target.value,
                                })
                              }
                              placeholder="e.g. Surgery"
                              className="h-9 text-sm"
                            />
                          </Field>
                        </div>
                        <Field label="Address">
                          <Textarea
                            value={newCompanyForm.organizationAddress ?? ""}
                            onChange={(e) =>
                              setNewCompanyForm({
                                ...newCompanyForm,
                                organizationAddress: e.target.value,
                              })
                            }
                            rows={2}
                            className="text-sm resize-none"
                          />
                        </Field>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            className="flex-1 h-8 text-xs"
                            disabled={savingCompany}
                            onClick={handleSaveNewCompany}
                          >
                            {savingCompany ? "Saving…" : "Add company"}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 text-xs"
                            onClick={() => {
                              setAddingCompany(false);
                              setNewCompanyForm({});
                            }}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {!editCustomer && localCompanies.length === 0 && (
                  <div className="text-xs text-muted-foreground text-center py-4 border border-dashed border-border rounded-lg">
                    No companies added yet — you can add them after creating the
                    customer too
                  </div>
                )}
                {editCustomer &&
                  editCustomer.companies.length === 0 &&
                  !addingCompany && (
                    <div className="text-xs text-muted-foreground text-center py-4 border border-dashed border-border rounded-lg">
                      No company affiliations yet
                    </div>
                  )}
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
