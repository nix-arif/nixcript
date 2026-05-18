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
} from "@/server/customer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
} from "lucide-react";
import { cn } from "@/lib/utils";

type Customer = Awaited<ReturnType<typeof getCustomers>>[number];

const TITLES = ["Dr", "Mr", "Ms", "Mdm", "Prof", "Dato", "Datin", "Tan Sri"];

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

const schema = z.object({
  title: z.string().optional(),
  name: z.string().min(1, "Name is required"),
  position: z.string().optional(),
  department: z.string().optional(),
  contactNo: z.string().optional(),
  email: z.string().email("Invalid email").optional().or(z.literal("")),
  organizationName: z.string().optional(),
  organizationAddress: z.string().optional(),
});
type FormValues = z.infer<typeof schema>;

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
    reset({
      title: "",
      name: "",
      position: "",
      department: "",
      contactNo: "",
      email: "",
      organizationName: "",
      organizationAddress: "",
    });
    setEditCustomer(null);
    setViewCustomer(null);
    setSheetOpen(true);
  };

  const openEdit = (c: Customer) => {
    reset({
      title: c.title ?? "",
      name: c.name,
      position: c.position ?? "",
      department: c.department ?? "",
      contactNo: c.contactNo ?? "",
      email: c.email ?? "",
      organizationName: c.organizationName ?? "",
      organizationAddress: c.organizationAddress ?? "",
    });
    setEditCustomer(c);
    setViewCustomer(null);
    setSheetOpen(true);
  };

  const openView = (c: Customer) => {
    setViewCustomer(c);
    setEditCustomer(null);
    setSheetOpen(true);
  };

  const closeSheet = () => {
    setSheetOpen(false);
    setEditCustomer(null);
    setViewCustomer(null);
  };

  const onSubmit = async (data: FormValues) => {
    setSaving(true);
    try {
      if (editCustomer) {
        await updateCustomer(editCustomer.id, data);
        toast.success("Customer updated");
      } else {
        await createCustomer(data);
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

  const totalPages = Math.ceil(customers.length / PER_PAGE);
  const paginated = customers.slice((page - 1) * PER_PAGE, page * PER_PAGE);
  const isReadOnly = !!viewCustomer && !editCustomer;

  return (
    <div className="p-6 max-w-5xl">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Customers</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage your customer database
          </p>
        </div>
        {canEdit && (
          <Button onClick={openCreate} className="gap-2">
            <PlusIcon className="w-4 h-4" /> New customer
          </Button>
        )}
      </div>

      {/* Search */}
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1">
          <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="Search by name, organization, email..."
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
        {/* Header */}
        <div className="grid grid-cols-[2fr_2fr_1.5fr_1.5fr_1fr_80px] px-4 py-2.5 bg-muted/20 border-b border-border">
          {[
            "Customer",
            "Organization",
            "Position",
            "Department",
            "Contact",
            "",
          ].map((h) => (
            <div
              key={h}
              className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground"
            >
              {h}
            </div>
          ))}
        </div>

        {/* Empty */}
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
          paginated.map((c, i) => (
            <div
              key={c.id}
              className={cn(
                "grid grid-cols-[2fr_2fr_1.5fr_1.5fr_1fr_80px] px-4 py-3 items-center",
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
                    {c.createdAt
                      ? new Date(c.createdAt).toLocaleDateString("en-MY", {
                          day: "2-digit",
                          month: "short",
                          year: "numeric",
                        })
                      : ""}
                  </div>
                </div>
              </div>

              {/* Organization */}
              <div className="min-w-0 pr-3">
                <div className="text-sm truncate">
                  {c.organizationName ?? "—"}
                </div>
                <div className="text-[11px] text-muted-foreground truncate">
                  {c.organizationAddress ?? ""}
                </div>
              </div>

              {/* Position */}
              <div className="text-sm text-muted-foreground truncate pr-2">
                {c.position ?? "—"}
              </div>

              {/* Department */}
              <div className="text-sm text-muted-foreground truncate pr-2">
                {c.department ?? "—"}
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
          ))
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
        <SheetContent className="w-full max-w-lg! overflow-y-auto px-10">
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
            /* View mode */
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
                    {[viewCustomer.position, viewCustomer.department]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                </div>
              </div>

              {[
                { label: "Position", value: viewCustomer.position },
                { label: "Department", value: viewCustomer.department },
                { label: "Contact no.", value: viewCustomer.contactNo },
                { label: "Email", value: viewCustomer.email },
                { label: "Organization", value: viewCustomer.organizationName },
                {
                  label: "Organization address",
                  value: viewCustomer.organizationAddress,
                },
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

              {canEdit && (
                <Button
                  className="w-full mt-4 gap-2"
                  variant="outline"
                  onClick={() => openEdit(viewCustomer)}
                >
                  <PencilIcon className="w-3.5 h-3.5" /> Edit customer
                </Button>
              )}
            </div>
          ) : (
            /* Create / Edit form */
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

              {/* Position + Department */}
              <div className="grid grid-cols-2 gap-3">
                <Field label="Position / job title">
                  <Input
                    {...register("position")}
                    placeholder="e.g. Procurement Officer"
                    className="h-9 text-sm"
                  />
                </Field>
                <Field label="Department">
                  <Input
                    {...register("department")}
                    placeholder="e.g. Surgery, Finance"
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

              {/* Organization */}
              <div className="border-t border-border pt-4">
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
                  Organization
                </div>
                <div className="space-y-3">
                  <Field label="Organization name">
                    <Input
                      {...register("organizationName")}
                      placeholder="e.g. Hospital Kuala Lumpur"
                      className="h-9 text-sm"
                    />
                  </Field>
                  <Field label="Organization address">
                    <Textarea
                      {...register("organizationAddress")}
                      placeholder="Full address"
                      rows={3}
                      className="text-sm resize-none"
                    />
                  </Field>
                </div>
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
                  {editCustomer ? "Update customer" : "Create customer"}
                </Button>
              </div>
            </form>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
