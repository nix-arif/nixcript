"use client";

import { useState, useCallback, useRef } from "react";
import { toast } from "sonner";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  createCustomer,
  updateCustomer,
  deleteCustomer,
  getCustomers,
  getCustomerOrganizations,
  getCustomerOrganizationWithMembers,
  searchCustomerOrganizations,
  createCustomerOrganization,
  updateCustomerOrganization,
  deleteCustomerOrganization,
  addCustomerOrgMembership,
  updateCustomerOrgMembership,
  deleteCustomerOrgMembership,
  type CustomerOrgMembership,
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
  StarIcon,
  UsersIcon,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type Customer = Awaited<ReturnType<typeof getCustomers>>[number];
type OrgRow = Awaited<ReturnType<typeof getCustomerOrganizations>>[number];
type OrgWithMembers = NonNullable<Awaited<ReturnType<typeof getCustomerOrganizationWithMembers>>>;
type OrgSearchResult = Awaited<ReturnType<typeof searchCustomerOrganizations>>[number];

const TITLES = [
  "Dr", "Matron", "Sr", "MA", "Mr", "Ms", "Mdm", "Prof",
  "Dato", "Datin", "Tan Sri", "Tuan", "Puan", "Encik", "KJ",
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
  return name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);
}

const customerSchema = z.object({
  title: z.string().optional(),
  name: z.string().min(1, "Name is required"),
  contactNo: z.string().optional(),
  email: z.string().email("Invalid email").optional().or(z.literal("")),
});
type CustomerForm = z.infer<typeof customerSchema>;

const orgSchema = z.object({
  name: z.string().min(1, "Name is required"),
  address: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email("Invalid email").optional().or(z.literal("")),
});
type OrgForm = z.infer<typeof orgSchema>;

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
      <label className="block text-xs font-medium text-muted-foreground">{label}</label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

// ── Org search typeahead ─────────────────────────────────────────────────────

function OrgPicker({
  value,
  onSelect,
  onClear,
}: {
  value: { id: string; name: string } | null;
  onSelect: (org: { id: string; name: string; address?: string | null }) => void;
  onClear: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<OrgSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = (q: string) => {
    setQuery(q);
    if (timer.current) clearTimeout(timer.current);
    if (!q.trim()) { setResults([]); return; }
    timer.current = setTimeout(async () => {
      setLoading(true);
      try {
        const rows = await searchCustomerOrganizations(q);
        setResults(rows);
      } finally {
        setLoading(false);
      }
    }, 300);
  };

  if (value) {
    return (
      <div className="flex items-center gap-2 h-9 px-3 rounded-md border border-border bg-muted/20 text-sm">
        <BuildingIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        <span className="flex-1 truncate">{value.name}</span>
        <button type="button" onClick={onClear} className="text-muted-foreground hover:text-foreground">
          <XIcon className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="relative">
        <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
        <Input
          value={query}
          onChange={(e) => search(e.target.value)}
          placeholder="Search or type new org name…"
          className="pl-9 h-9 text-sm"
        />
      </div>
      {(results.length > 0 || (query.trim().length > 1)) && (
        <div className="absolute z-50 mt-1 w-full bg-background border border-border rounded-md shadow-md overflow-hidden">
          {loading ? (
            <div className="px-3 py-2 text-xs text-muted-foreground">Searching…</div>
          ) : (
            <>
              {results.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  className="w-full text-left px-3 py-2 text-sm hover:bg-muted/40 flex items-center gap-2"
                  onClick={() => { onSelect(r); setQuery(""); setResults([]); }}
                >
                  <BuildingIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <span className="truncate">{r.name}</span>
                </button>
              ))}
              {query.trim().length > 1 && !results.some((r) => r.name.toLowerCase() === query.trim().toLowerCase()) && (
                <button
                  type="button"
                  className="w-full text-left px-3 py-2 text-sm hover:bg-muted/40 flex items-center gap-2 border-t border-border text-primary"
                  onClick={() => {
                    onSelect({ id: "__new__", name: query.trim() });
                    setQuery("");
                    setResults([]);
                  }}
                >
                  <PlusIcon className="w-3.5 h-3.5 shrink-0" />
                  <span>Create "{query.trim()}"</span>
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Props ────────────────────────────────────────────────────────────────────

interface Props {
  initialCustomers: Customer[];
  initialOrganizations: OrgRow[];
  canEdit: boolean;
}

export function CustomerClient({ initialCustomers, initialOrganizations, canEdit }: Props) {
  const [tab, setTab] = useState<"customers" | "organizations">("customers");

  // ── Customer state ──────────────────────────────────────────────────────
  const [customers, setCustomers] = useState(initialCustomers);
  const [search, setSearch] = useState("");
  const [searching, setSearching] = useState(false);
  const [customerSheet, setCustomerSheet] = useState<"create" | "edit" | "view" | null>(null);
  const [activeCustomer, setActiveCustomer] = useState<Customer | null>(null);
  const [savingCustomer, setSavingCustomer] = useState(false);
  const [deletingCustomer, setDeletingCustomer] = useState<string | null>(null);
  const [customerPage, setCustomerPage] = useState(1);
  const C_PER_PAGE = 10;

  // New-customer local memberships (picked orgs)
  const [localMemberships, setLocalMemberships] = useState<
    { orgId: string | null; orgName: string; orgAddress?: string; position?: string; department?: string; isPrimary: boolean }[]
  >([]);
  const [addingOrgToCustomer, setAddingOrgToCustomer] = useState(false);
  const [newMembershipOrg, setNewMembershipOrg] = useState<{ id: string; name: string; address?: string | null } | null>(null);
  const [newMembershipPosition, setNewMembershipPosition] = useState("");
  const [newMembershipDept, setNewMembershipDept] = useState("");
  const [savingMembership, setSavingMembership] = useState(false);
  const [editingMembershipId, setEditingMembershipId] = useState<string | null>(null);
  const [editingMembershipForm, setEditingMembershipForm] = useState({ position: "", department: "" });

  // ── Organization state ──────────────────────────────────────────────────
  const [organizations, setOrganizations] = useState(initialOrganizations);
  const [orgSearch, setOrgSearch] = useState("");
  const [orgSheet, setOrgSheet] = useState<"create" | "edit" | null>(null);
  const [activeOrg, setActiveOrg] = useState<OrgRow | null>(null);
  const [savingOrg, setSavingOrg] = useState(false);
  const [deletingOrg, setDeletingOrg] = useState<string | null>(null);

  // Org members sheet
  const [orgMembersSheet, setOrgMembersSheet] = useState(false);
  const [orgWithMembers, setOrgWithMembers] = useState<OrgWithMembers | null>(null);
  const [loadingOrgMembers, setLoadingOrgMembers] = useState(false);
  const [addingMemberToOrg, setAddingMemberToOrg] = useState(false);
  const [newOrgMemberCustomer, setNewOrgMemberCustomer] = useState<{ id: string; name: string } | null>(null);
  const [newOrgMemberPosition, setNewOrgMemberPosition] = useState("");
  const [newOrgMemberDept, setNewOrgMemberDept] = useState("");
  const [savingOrgMember, setSavingOrgMember] = useState(false);
  // Customer search within org members sheet
  const [customerSearchQuery, setCustomerSearchQuery] = useState("");
  const [customerSearchResults, setCustomerSearchResults] = useState<Customer[]>([]);
  const [searchingCustomers, setSearchingCustomers] = useState(false);
  const customerSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const {
    register: regCustomer,
    handleSubmit: handleCustomerSubmit,
    setValue: setCustomerValue,
    watch: watchCustomer,
    reset: resetCustomer,
    formState: { errors: customerErrors },
  } = useForm<CustomerForm>({ resolver: zodResolver(customerSchema) });

  const {
    register: regOrg,
    handleSubmit: handleOrgSubmit,
    reset: resetOrg,
    formState: { errors: orgErrors },
  } = useForm<OrgForm>({ resolver: zodResolver(orgSchema) });

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refreshCustomers = useCallback(async (q?: string) => {
    const rows = await getCustomers(q);
    setCustomers(rows);
  }, []);

  const refreshOrganizations = useCallback(async () => {
    const rows = await getCustomerOrganizations();
    setOrganizations(rows);
  }, []);

  const handleSearch = (q: string) => {
    setSearch(q);
    setCustomerPage(1);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(async () => {
      setSearching(true);
      try { await refreshCustomers(q); } finally { setSearching(false); }
    }, 350);
  };

  // ── Customer sheet ────────────────────────────────────────────────────────

  const openCreateCustomer = () => {
    (document.activeElement as HTMLElement)?.blur();
    resetCustomer({ title: "", name: "", contactNo: "", email: "" });
    setLocalMemberships([]);
    setActiveCustomer(null);
    setAddingOrgToCustomer(false);
    setCustomerSheet("create");
  };

  const openEditCustomer = (c: Customer) => {
    (document.activeElement as HTMLElement)?.blur();
    resetCustomer({ title: c.title ?? "", name: c.name, contactNo: c.contactNo ?? "", email: c.email ?? "" });
    setActiveCustomer(c);
    setAddingOrgToCustomer(false);
    setEditingMembershipId(null);
    setCustomerSheet("edit");
  };

  const openViewCustomer = (c: Customer) => {
    (document.activeElement as HTMLElement)?.blur();
    setActiveCustomer(c);
    setCustomerSheet("view");
  };

  const closeCustomerSheet = () => {
    setCustomerSheet(null);
    setActiveCustomer(null);
    setAddingOrgToCustomer(false);
    setEditingMembershipId(null);
    setNewMembershipOrg(null);
    setNewMembershipPosition("");
    setNewMembershipDept("");
  };

  const onSubmitCustomer = async (data: CustomerForm) => {
    setSavingCustomer(true);
    try {
      if (activeCustomer && customerSheet === "edit") {
        await updateCustomer(activeCustomer.id, data);
        toast.success("Customer updated");
      } else {
        await createCustomer({
          ...data,
          companies: localMemberships.map((m) => ({
            orgName: m.orgName,
            organizationAddress: m.orgAddress,
            position: m.position,
            department: m.department,
            isPrimary: m.isPrimary,
          })),
        });
        toast.success("Customer created");
      }
      await refreshCustomers(search);
      closeCustomerSheet();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSavingCustomer(false);
    }
  };

  const handleDeleteCustomer = async (id: string) => {
    if (!confirm("Delete this customer? This cannot be undone.")) return;
    setDeletingCustomer(id);
    try {
      await deleteCustomer(id);
      toast.success("Customer deleted");
      await refreshCustomers(search);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setDeletingCustomer(null);
    }
  };

  // ── Membership management (in customer edit sheet) ────────────────────────

  const handleSaveNewMembership = async () => {
    if (!activeCustomer || !newMembershipOrg) {
      toast.error("Select an organization first");
      return;
    }
    setSavingMembership(true);
    try {
      let orgId = newMembershipOrg.id;
      if (orgId === "__new__") {
        const { row, existed } = await createCustomerOrganization({
          name: newMembershipOrg.name,
          address: newMembershipOrg.address ?? undefined,
        });
        if (existed) toast.info(`Using existing organisation "${row.name}"`);
        orgId = row.id;
      }
      await addCustomerOrgMembership(activeCustomer.id, orgId, {
        position: newMembershipPosition || undefined,
        department: newMembershipDept || undefined,
        isPrimary: activeCustomer.memberships.length === 0,
      });
      toast.success("Organisation linked");
      setAddingOrgToCustomer(false);
      setNewMembershipOrg(null);
      setNewMembershipPosition("");
      setNewMembershipDept("");
      const rows = await getCustomers(search);
      setCustomers(rows);
      const updated = rows.find((r) => r.id === activeCustomer.id);
      if (updated) setActiveCustomer(updated);
      await refreshOrganizations();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSavingMembership(false);
    }
  };

  const handleUpdateMembership = async (membershipId: string) => {
    setSavingMembership(true);
    try {
      await updateCustomerOrgMembership(membershipId, {
        position: editingMembershipForm.position,
        department: editingMembershipForm.department,
      });
      toast.success("Membership updated");
      setEditingMembershipId(null);
      const rows = await getCustomers(search);
      setCustomers(rows);
      const updated = rows.find((r) => r.id === activeCustomer?.id);
      if (updated) setActiveCustomer(updated);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSavingMembership(false);
    }
  };

  const handleDeleteMembership = async (membershipId: string) => {
    if (!confirm("Remove this organisation affiliation?")) return;
    try {
      await deleteCustomerOrgMembership(membershipId);
      toast.success("Affiliation removed");
      const rows = await getCustomers(search);
      setCustomers(rows);
      const updated = rows.find((r) => r.id === activeCustomer?.id);
      if (updated) setActiveCustomer(updated);
      await refreshOrganizations();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const handleSetPrimary = async (membershipId: string) => {
    try {
      await updateCustomerOrgMembership(membershipId, { isPrimary: true });
      const rows = await getCustomers(search);
      setCustomers(rows);
      const updated = rows.find((r) => r.id === activeCustomer?.id);
      if (updated) setActiveCustomer(updated);
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  // ── Organization CRUD ─────────────────────────────────────────────────────

  const openCreateOrg = () => {
    resetOrg({ name: "", address: "", phone: "", email: "" });
    setActiveOrg(null);
    setOrgSheet("create");
  };

  const openEditOrg = (org: OrgRow) => {
    resetOrg({ name: org.name, address: org.address ?? "", phone: org.phone ?? "", email: org.email ?? "" });
    setActiveOrg(org);
    setOrgSheet("edit");
  };

  const closeOrgSheet = () => {
    setOrgSheet(null);
    setActiveOrg(null);
  };

  const onSubmitOrg = async (data: OrgForm) => {
    setSavingOrg(true);
    try {
      if (activeOrg && orgSheet === "edit") {
        await updateCustomerOrganization(activeOrg.id, data);
        toast.success("Organisation updated");
      } else {
        const { existed } = await createCustomerOrganization(data);
        if (existed) {
          toast.info("An organisation with that name already exists");
        } else {
          toast.success("Organisation created");
        }
      }
      await refreshOrganizations();
      closeOrgSheet();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSavingOrg(false);
    }
  };

  const handleDeleteOrg = async (id: string) => {
    if (!confirm("Delete this organisation? All member links will be removed.")) return;
    setDeletingOrg(id);
    try {
      await deleteCustomerOrganization(id);
      toast.success("Organisation deleted");
      await refreshOrganizations();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setDeletingOrg(null);
    }
  };

  // ── Org members sheet ─────────────────────────────────────────────────────

  const openOrgMembers = async (org: OrgRow) => {
    setOrgMembersSheet(true);
    setOrgWithMembers(null);
    setLoadingOrgMembers(true);
    setAddingMemberToOrg(false);
    setNewOrgMemberCustomer(null);
    setNewOrgMemberPosition("");
    setNewOrgMemberDept("");
    setCustomerSearchQuery("");
    setCustomerSearchResults([]);
    try {
      const data = await getCustomerOrganizationWithMembers(org.id);
      setOrgWithMembers(data);
    } finally {
      setLoadingOrgMembers(false);
    }
  };

  const closeOrgMembersSheet = () => {
    setOrgMembersSheet(false);
    setOrgWithMembers(null);
    setAddingMemberToOrg(false);
    setNewOrgMemberCustomer(null);
    setCustomerSearchQuery("");
    setCustomerSearchResults([]);
  };

  const handleCustomerSearch = (q: string) => {
    setCustomerSearchQuery(q);
    if (customerSearchTimer.current) clearTimeout(customerSearchTimer.current);
    if (!q.trim()) { setCustomerSearchResults([]); return; }
    customerSearchTimer.current = setTimeout(async () => {
      setSearchingCustomers(true);
      try {
        const rows = await getCustomers(q);
        setCustomerSearchResults(rows);
      } finally {
        setSearchingCustomers(false);
      }
    }, 300);
  };

  const handleAddMemberToOrg = async () => {
    if (!orgWithMembers || !newOrgMemberCustomer) {
      toast.error("Select a customer first");
      return;
    }
    setSavingOrgMember(true);
    try {
      await addCustomerOrgMembership(newOrgMemberCustomer.id, orgWithMembers.id, {
        position: newOrgMemberPosition || undefined,
        department: newOrgMemberDept || undefined,
        isPrimary: false,
      });
      toast.success("Member added");
      setAddingMemberToOrg(false);
      setNewOrgMemberCustomer(null);
      setNewOrgMemberPosition("");
      setNewOrgMemberDept("");
      setCustomerSearchQuery("");
      setCustomerSearchResults([]);
      const data = await getCustomerOrganizationWithMembers(orgWithMembers.id);
      setOrgWithMembers(data);
      await refreshOrganizations();
      await refreshCustomers(search);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSavingOrgMember(false);
    }
  };

  const handleRemoveMemberFromOrg = async (membershipId: string) => {
    if (!confirm("Remove this member from the organisation?")) return;
    try {
      await deleteCustomerOrgMembership(membershipId);
      toast.success("Member removed");
      if (orgWithMembers) {
        const data = await getCustomerOrganizationWithMembers(orgWithMembers.id);
        setOrgWithMembers(data);
      }
      await refreshOrganizations();
      await refreshCustomers(search);
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  // ── Derived ───────────────────────────────────────────────────────────────

  const totalCustomerPages = Math.ceil(customers.length / C_PER_PAGE);
  const paginatedCustomers = customers.slice((customerPage - 1) * C_PER_PAGE, customerPage * C_PER_PAGE);

  const filteredOrgs = organizations.filter((o) =>
    !orgSearch.trim() || o.name.toLowerCase().includes(orgSearch.trim().toLowerCase()),
  );

  return (
    <div className="p-6">
      <PageHeader
        title="Customers"
        description="Manage customers and their organisation affiliations"
        action={
          canEdit ? (
            tab === "customers" ? (
              <Button onClick={openCreateCustomer} className="gap-2">
                <PlusIcon className="w-4 h-4" /> New customer
              </Button>
            ) : (
              <Button onClick={openCreateOrg} className="gap-2">
                <PlusIcon className="w-4 h-4" /> New organisation
              </Button>
            )
          ) : undefined
        }
      />

      {/* Tab bar */}
      <div className="flex gap-1 mb-5 border-b border-border">
        {(["customers", "organizations"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "px-4 py-2 text-sm font-medium -mb-px border-b-2 transition-colors capitalize",
              tab === t
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t === "customers" ? `Customers (${customers.length})` : `Organisations (${organizations.length})`}
          </button>
        ))}
      </div>

      {/* ── Customers tab ─────────────────────────────────────────────────── */}
      {tab === "customers" && (
        <>
          <div className="flex items-center gap-3 mb-4">
            <div className="relative flex-1">
              <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => handleSearch(e.target.value)}
                placeholder="Search by name, organisation, email, contact…"
                className="pl-9 h-9 text-sm"
              />
              {search && (
                <button
                  onClick={() => {
                    if (searchTimer.current) clearTimeout(searchTimer.current);
                    setSearch("");
                    setCustomerPage(1);
                    setSearching(true);
                    refreshCustomers("").finally(() => setSearching(false));
                  }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <XIcon className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            {!searching && (
              <div className="text-xs text-muted-foreground whitespace-nowrap">
                {customers.length} customer{customers.length !== 1 ? "s" : ""}
              </div>
            )}
          </div>

          <div className="bg-background border border-border rounded-xl overflow-hidden mb-4">
            <div className="grid grid-cols-[2fr_2fr_1.5fr_1fr_80px] px-4 py-2.5 bg-muted/20 border-b border-border">
              {["Customer", "Primary organisation", "Position", "Contact", ""].map((h) => (
                <div key={h} className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  {h}
                </div>
              ))}
            </div>

            {searching ? (
              Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="grid grid-cols-[2fr_2fr_1.5fr_1fr_80px] px-4 py-3 items-center border-b border-border last:border-0">
                  <div className="flex items-center gap-3">
                    <Skeleton className="w-8 h-8 rounded-lg shrink-0" />
                    <div className="flex flex-col gap-1.5">
                      <Skeleton className="h-3.5 w-28" />
                      <Skeleton className="h-3 w-20" />
                    </div>
                  </div>
                  <Skeleton className="h-3.5 w-36" />
                  <Skeleton className="h-3.5 w-24" />
                  <Skeleton className="h-3.5 w-20" />
                  <div className="flex justify-end gap-1">
                    <Skeleton className="h-7 w-7 rounded-md" />
                    <Skeleton className="h-7 w-7 rounded-md" />
                  </div>
                </div>
              ))
            ) : paginatedCustomers.length === 0 ? (
              <div className="py-16 text-center text-muted-foreground">
                <div className="text-sm font-medium mb-1">No customers found</div>
                <div className="text-xs mb-4">
                  {search ? "Try a different search term" : "Add your first customer to get started"}
                </div>
                {canEdit && !search && (
                  <Button variant="outline" size="sm" className="gap-2" onClick={openCreateCustomer}>
                    <PlusIcon className="w-3.5 h-3.5" /> New customer
                  </Button>
                )}
              </div>
            ) : (
              paginatedCustomers.map((c, i) => {
                const primary = c.memberships.find((co) => co.isPrimary) ?? c.memberships[0] ?? null;
                return (
                  <div
                    key={c.id}
                    className={cn(
                      "grid grid-cols-[2fr_2fr_1.5fr_1fr_80px] px-4 py-3 items-center",
                      i < paginatedCustomers.length - 1 ? "border-b border-border" : "",
                      i % 2 === 1 ? "bg-muted/10" : "",
                    )}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center text-xs font-medium shrink-0", getAvatarColor(c.name))}>
                        {getInitials(c.name)}
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">
                          {[c.title, c.name].filter(Boolean).join(" ")}
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          {c.memberships.length > 0
                            ? `${c.memberships.length} org${c.memberships.length !== 1 ? "s" : ""}`
                            : "No organisation"}
                        </div>
                      </div>
                    </div>
                    <div className="min-w-0 pr-3">
                      <div className="text-sm truncate">{primary?.orgName ?? "—"}</div>
                      <div className="text-[11px] text-muted-foreground truncate">{primary?.department ?? ""}</div>
                    </div>
                    <div className="text-sm text-muted-foreground truncate pr-2">{primary?.position ?? "—"}</div>
                    <div className="text-sm text-muted-foreground truncate">{c.contactNo ?? c.email ?? "—"}</div>
                    <div className="flex items-center gap-1 justify-end">
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground" onClick={() => openViewCustomer(c)}>
                        <EyeIcon className="w-3.5 h-3.5" />
                      </Button>
                      {canEdit && (
                        <>
                          <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground" onClick={() => openEditCustomer(c)}>
                            <PencilIcon className="w-3.5 h-3.5" />
                          </Button>
                          <Button
                            variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                            disabled={deletingCustomer === c.id}
                            onClick={() => handleDeleteCustomer(c.id)}
                          >
                            {deletingCustomer === c.id
                              ? <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                              : <TrashIcon className="w-3.5 h-3.5" />}
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {totalCustomerPages > 1 && (
            <div className="flex items-center justify-between">
              <div className="text-xs text-muted-foreground">
                Showing {(customerPage - 1) * C_PER_PAGE + 1}–{Math.min(customerPage * C_PER_PAGE, customers.length)} of {customers.length}
              </div>
              <div className="flex gap-1">
                <Button variant="outline" size="sm" className="h-7 text-xs" disabled={customerPage === 1} onClick={() => setCustomerPage(customerPage - 1)}>Previous</Button>
                {Array.from({ length: totalCustomerPages }, (_, i) => i + 1).map((p) => (
                  <Button key={p} variant={p === customerPage ? "default" : "outline"} size="sm" className="h-7 w-7 p-0 text-xs" onClick={() => setCustomerPage(p)}>{p}</Button>
                ))}
                <Button variant="outline" size="sm" className="h-7 text-xs" disabled={customerPage === totalCustomerPages} onClick={() => setCustomerPage(customerPage + 1)}>Next</Button>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Organisations tab ─────────────────────────────────────────────── */}
      {tab === "organizations" && (
        <>
          <div className="flex items-center gap-3 mb-4">
            <div className="relative flex-1">
              <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input
                value={orgSearch}
                onChange={(e) => setOrgSearch(e.target.value)}
                placeholder="Filter organisations…"
                className="pl-9 h-9 text-sm"
              />
              {orgSearch && (
                <button onClick={() => setOrgSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  <XIcon className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <div className="text-xs text-muted-foreground whitespace-nowrap">
              {organizations.length} org{organizations.length !== 1 ? "s" : ""}
            </div>
          </div>

          <div className="bg-background border border-border rounded-xl overflow-hidden">
            <div className="grid grid-cols-[2fr_3fr_80px_100px] px-4 py-2.5 bg-muted/20 border-b border-border">
              {["Organisation", "Address", "Members", ""].map((h) => (
                <div key={h} className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{h}</div>
              ))}
            </div>

            {filteredOrgs.length === 0 ? (
              <div className="py-16 text-center text-muted-foreground">
                <div className="text-sm font-medium mb-1">No organisations found</div>
                <div className="text-xs mb-4">
                  {orgSearch ? "Try a different name" : "Create your first organisation to get started"}
                </div>
                {canEdit && !orgSearch && (
                  <Button variant="outline" size="sm" className="gap-2" onClick={openCreateOrg}>
                    <PlusIcon className="w-3.5 h-3.5" /> New organisation
                  </Button>
                )}
              </div>
            ) : (
              filteredOrgs.map((org, i) => (
                <div
                  key={org.id}
                  className={cn(
                    "grid grid-cols-[2fr_3fr_80px_100px] px-4 py-3 items-center",
                    i < filteredOrgs.length - 1 ? "border-b border-border" : "",
                    i % 2 === 1 ? "bg-muted/10" : "",
                  )}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <BuildingIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{org.name}</div>
                      {(org.phone || org.email) && (
                        <div className="text-[11px] text-muted-foreground truncate">
                          {[org.phone, org.email].filter(Boolean).join(" · ")}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="text-sm text-muted-foreground truncate pr-3">{org.address ?? "—"}</div>
                  <div className="flex items-center gap-1.5">
                    <UsersIcon className="w-3.5 h-3.5 text-muted-foreground" />
                    <span className="text-sm">{org.memberCount}</span>
                  </div>
                  <div className="flex items-center gap-1 justify-end">
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground" onClick={() => openOrgMembers(org)} title="View members">
                      <UsersIcon className="w-3.5 h-3.5" />
                    </Button>
                    {canEdit && (
                      <>
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground" onClick={() => openEditOrg(org)}>
                          <PencilIcon className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                          disabled={deletingOrg === org.id}
                          onClick={() => handleDeleteOrg(org.id)}
                        >
                          {deletingOrg === org.id
                            ? <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                            : <TrashIcon className="w-3.5 h-3.5" />}
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </>
      )}

      {/* ── Customer sheet ─────────────────────────────────────────────────── */}
      <Sheet open={customerSheet !== null} onOpenChange={closeCustomerSheet}>
        <SheetContent className="w-full max-w-lg! overflow-y-auto px-10" aria-describedby={undefined}>
          <SheetHeader className="mb-5">
            <SheetTitle>
              {customerSheet === "view" ? "Customer details" : customerSheet === "edit" ? "Edit customer" : "New customer"}
            </SheetTitle>
          </SheetHeader>

          {customerSheet === "view" && activeCustomer ? (
            <div className="space-y-1">
              <div className="flex items-center gap-4 p-4 bg-muted/30 rounded-lg mb-4">
                <div className={cn("w-12 h-12 rounded-lg flex items-center justify-center text-base font-medium shrink-0", getAvatarColor(activeCustomer.name))}>
                  {getInitials(activeCustomer.name)}
                </div>
                <div>
                  <div className="font-semibold">{[activeCustomer.title, activeCustomer.name].filter(Boolean).join(" ")}</div>
                  <div className="text-sm text-muted-foreground">
                    {activeCustomer.memberships.length} organisation{activeCustomer.memberships.length !== 1 ? "s" : ""}
                  </div>
                </div>
              </div>
              {[
                { label: "Contact no.", value: activeCustomer.contactNo },
                { label: "Email", value: activeCustomer.email },
                { label: "Added by", value: activeCustomer.createdByName },
                {
                  label: "Added on",
                  value: activeCustomer.createdAt
                    ? new Date(activeCustomer.createdAt).toLocaleDateString("en-MY", { day: "2-digit", month: "long", year: "numeric" })
                    : null,
                },
              ].map((f) =>
                f.value ? (
                  <div key={f.label} className="flex justify-between py-2.5 border-b border-border text-sm">
                    <span className="text-muted-foreground">{f.label}</span>
                    <span className="font-medium text-right max-w-xs">{f.value}</span>
                  </div>
                ) : null,
              )}
              {activeCustomer.memberships.length > 0 && (
                <div className="pt-4">
                  <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">Organisation affiliations</div>
                  <div className="space-y-3">
                    {activeCustomer.memberships.map((co) => (
                      <div key={co.id} className="border border-border rounded-lg p-3">
                        <div className="flex items-center gap-2 mb-2">
                          <BuildingIcon className="w-3.5 h-3.5 text-muted-foreground" />
                          <span className="text-sm font-medium">{co.orgName ?? "—"}</span>
                          {co.isPrimary && (
                            <span className="text-[10px] bg-primary/10 text-primary rounded px-1.5 py-0.5">Primary</span>
                          )}
                        </div>
                        {[
                          { label: "Position", value: co.position },
                          { label: "Department", value: co.department },
                          { label: "Address", value: co.orgAddress },
                        ].map((f) =>
                          f.value ? (
                            <div key={f.label} className="flex gap-2 text-xs text-muted-foreground">
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
            <div className="space-y-5">
              <form onSubmit={handleCustomerSubmit(onSubmitCustomer)} className="space-y-4">
                <div className="grid grid-cols-[100px_1fr] gap-3">
                  <Field label="Title">
                    <Select onValueChange={(v) => setCustomerValue("title", v)} defaultValue={watchCustomer("title")}>
                      <SelectTrigger className="h-9 text-sm">
                        <SelectValue placeholder="Title" />
                      </SelectTrigger>
                      <SelectContent>
                        {TITLES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="Full name" error={customerErrors.name?.message}>
                    <Input {...regCustomer("name")} placeholder="e.g. Ahmad Hafizi" className="h-9 text-sm" />
                  </Field>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Contact no.">
                    <Input {...regCustomer("contactNo")} placeholder="+60 12 345 6789" className="h-9 text-sm" />
                  </Field>
                  <Field label="Email" error={customerErrors.email?.message}>
                    <Input type="email" {...regCustomer("email")} placeholder="contact@hospital.com" className="h-9 text-sm" />
                  </Field>
                </div>
                <div className="flex gap-2 pt-2">
                  <Button type="button" variant="outline" className="flex-1" onClick={closeCustomerSheet}>Cancel</Button>
                  <Button type="submit" disabled={savingCustomer} className="flex-1 gap-2">
                    {savingCustomer && <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />}
                    {activeCustomer ? "Update" : "Create customer"}
                  </Button>
                </div>
              </form>

              {/* Organisation affiliations */}
              <div className="border-t border-border pt-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Organisation affiliations</div>
                  {canEdit && (
                    <Button
                      type="button" variant="ghost" size="sm" className="h-7 text-xs gap-1"
                      onClick={() => {
                        if (customerSheet === "create") {
                          setLocalMemberships([...localMemberships, { orgId: null, orgName: "", isPrimary: localMemberships.length === 0 }]);
                        } else {
                          setAddingOrgToCustomer(true);
                          setNewMembershipOrg(null);
                          setNewMembershipPosition("");
                          setNewMembershipDept("");
                        }
                      }}
                    >
                      <PlusIcon className="w-3 h-3" /> Link organisation
                    </Button>
                  )}
                </div>

                {/* Create mode: local membership list */}
                {customerSheet === "create" && localMemberships.length > 0 && (
                  <div className="space-y-2">
                    {localMemberships.map((m, i) => (
                      <div key={i} className="border border-border rounded-lg p-3 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-medium text-muted-foreground">Organisation {i + 1}</span>
                          <div className="flex items-center gap-1">
                            {!m.isPrimary && (
                              <button
                                type="button"
                                title="Set as primary"
                                onClick={() => setLocalMemberships(localMemberships.map((x, j) => ({ ...x, isPrimary: j === i })))}
                                className="p-1 text-muted-foreground hover:text-amber-500"
                              >
                                <StarIcon className="w-3.5 h-3.5" />
                              </button>
                            )}
                            {m.isPrimary && (
                              <span className="text-[10px] bg-primary/10 text-primary rounded px-1.5 py-0.5">Primary</span>
                            )}
                            <button
                              type="button"
                              onClick={() => setLocalMemberships(localMemberships.filter((_, j) => j !== i))}
                              className="p-1 text-muted-foreground hover:text-destructive"
                            >
                              <XIcon className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                        <Field label="Organisation name">
                          <OrgPicker
                            value={m.orgName ? { id: m.orgId ?? "__new__", name: m.orgName } : null}
                            onSelect={(org) => setLocalMemberships(localMemberships.map((x, j) =>
                              j === i ? { ...x, orgId: org.id === "__new__" ? null : org.id, orgName: org.name, orgAddress: org.address ?? undefined } : x
                            ))}
                            onClear={() => setLocalMemberships(localMemberships.map((x, j) =>
                              j === i ? { ...x, orgId: null, orgName: "" } : x
                            ))}
                          />
                        </Field>
                        <div className="grid grid-cols-2 gap-2">
                          <Field label="Position">
                            <Input
                              value={m.position ?? ""}
                              onChange={(e) => setLocalMemberships(localMemberships.map((x, j) => j === i ? { ...x, position: e.target.value } : x))}
                              placeholder="e.g. Manager"
                              className="h-9 text-sm"
                            />
                          </Field>
                          <Field label="Department">
                            <Input
                              value={m.department ?? ""}
                              onChange={(e) => setLocalMemberships(localMemberships.map((x, j) => j === i ? { ...x, department: e.target.value } : x))}
                              placeholder="e.g. Surgery"
                              className="h-9 text-sm"
                            />
                          </Field>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {customerSheet === "create" && localMemberships.length === 0 && (
                  <div className="text-xs text-muted-foreground text-center py-4 border border-dashed border-border rounded-lg">
                    No organisations linked — you can add them after creating the customer too
                  </div>
                )}

                {/* Edit mode: existing memberships */}
                {customerSheet === "edit" && activeCustomer && (
                  <div className="space-y-2">
                    {activeCustomer.memberships.map((co) => (
                      <div key={co.id} className="border border-border rounded-lg overflow-hidden">
                        {editingMembershipId === co.id ? (
                          <div className="p-3 space-y-3">
                            <div className="grid grid-cols-2 gap-3">
                              <Field label="Position">
                                <Input
                                  value={editingMembershipForm.position}
                                  onChange={(e) => setEditingMembershipForm({ ...editingMembershipForm, position: e.target.value })}
                                  className="h-9 text-sm"
                                />
                              </Field>
                              <Field label="Department">
                                <Input
                                  value={editingMembershipForm.department}
                                  onChange={(e) => setEditingMembershipForm({ ...editingMembershipForm, department: e.target.value })}
                                  className="h-9 text-sm"
                                />
                              </Field>
                            </div>
                            <div className="flex gap-2">
                              <Button size="sm" className="flex-1 h-8 text-xs" disabled={savingMembership} onClick={() => handleUpdateMembership(co.id)}>Save</Button>
                              <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setEditingMembershipId(null)}>Cancel</Button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-start justify-between p-3">
                            <div className="flex items-start gap-2 min-w-0">
                              <BuildingIcon className="w-3.5 h-3.5 text-muted-foreground mt-0.5 shrink-0" />
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-sm font-medium truncate">{co.orgName ?? "—"}</span>
                                  {co.isPrimary && <span className="text-[10px] bg-primary/10 text-primary rounded px-1.5 py-0.5 shrink-0">Primary</span>}
                                </div>
                                {(co.position || co.department) && (
                                  <div className="text-xs text-muted-foreground">{[co.position, co.department].filter(Boolean).join(" · ")}</div>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-1 shrink-0 ml-2">
                              {!co.isPrimary && (
                                <button type="button" title="Set as primary" onClick={() => handleSetPrimary(co.id)} className="p-1 text-muted-foreground hover:text-amber-500 transition-colors">
                                  <StarIcon className="w-3.5 h-3.5" />
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => { setEditingMembershipId(co.id); setEditingMembershipForm({ position: co.position ?? "", department: co.department ?? "" }); }}
                                className="p-1 text-muted-foreground hover:text-foreground transition-colors"
                              >
                                <PencilIcon className="w-3.5 h-3.5" />
                              </button>
                              <button type="button" onClick={() => handleDeleteMembership(co.id)} className="p-1 text-muted-foreground hover:text-destructive transition-colors">
                                <XIcon className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}

                    {addingOrgToCustomer && (
                      <div className="border border-border rounded-lg p-3 space-y-3">
                        <Field label="Organisation">
                          <OrgPicker
                            value={newMembershipOrg}
                            onSelect={(org) => setNewMembershipOrg(org)}
                            onClear={() => setNewMembershipOrg(null)}
                          />
                        </Field>
                        <div className="grid grid-cols-2 gap-3">
                          <Field label="Position">
                            <Input
                              value={newMembershipPosition}
                              onChange={(e) => setNewMembershipPosition(e.target.value)}
                              placeholder="e.g. Manager"
                              className="h-9 text-sm"
                            />
                          </Field>
                          <Field label="Department">
                            <Input
                              value={newMembershipDept}
                              onChange={(e) => setNewMembershipDept(e.target.value)}
                              placeholder="e.g. Surgery"
                              className="h-9 text-sm"
                            />
                          </Field>
                        </div>
                        <div className="flex gap-2">
                          <Button size="sm" className="flex-1 h-8 text-xs" disabled={savingMembership} onClick={handleSaveNewMembership}>
                            {savingMembership ? "Saving…" : "Link organisation"}
                          </Button>
                          <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => { setAddingOrgToCustomer(false); setNewMembershipOrg(null); }}>
                            Cancel
                          </Button>
                        </div>
                      </div>
                    )}

                    {activeCustomer.memberships.length === 0 && !addingOrgToCustomer && (
                      <div className="text-xs text-muted-foreground text-center py-4 border border-dashed border-border rounded-lg">
                        No organisation affiliations yet
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* ── Organisation create/edit sheet ────────────────────────────────── */}
      <Sheet open={orgSheet !== null} onOpenChange={closeOrgSheet}>
        <SheetContent className="w-full max-w-lg! overflow-y-auto px-10" aria-describedby={undefined}>
          <SheetHeader className="mb-5">
            <SheetTitle>{orgSheet === "edit" ? "Edit organisation" : "New organisation"}</SheetTitle>
          </SheetHeader>
          <form onSubmit={handleOrgSubmit(onSubmitOrg)} className="space-y-4">
            <Field label="Organisation name" error={orgErrors.name?.message}>
              <Input {...regOrg("name")} placeholder="e.g. Hospital Kuala Lumpur" className="h-9 text-sm" />
            </Field>
            <Field label="Address">
              <Textarea {...regOrg("address")} placeholder="Full address" rows={3} className="text-sm resize-none" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Phone">
                <Input {...regOrg("phone")} placeholder="+60 3 1234 5678" className="h-9 text-sm" />
              </Field>
              <Field label="Email" error={orgErrors.email?.message}>
                <Input type="email" {...regOrg("email")} placeholder="info@org.com" className="h-9 text-sm" />
              </Field>
            </div>
            <div className="flex gap-2 pt-2">
              <Button type="button" variant="outline" className="flex-1" onClick={closeOrgSheet}>Cancel</Button>
              <Button type="submit" disabled={savingOrg} className="flex-1 gap-2">
                {savingOrg && <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />}
                {activeOrg ? "Update" : "Create organisation"}
              </Button>
            </div>
          </form>
        </SheetContent>
      </Sheet>

      {/* ── Organisation members sheet ────────────────────────────────────── */}
      <Sheet open={orgMembersSheet} onOpenChange={closeOrgMembersSheet}>
        <SheetContent className="w-full max-w-lg! overflow-y-auto px-10" aria-describedby={undefined}>
          <SheetHeader className="mb-5">
            <SheetTitle>
              {orgWithMembers ? orgWithMembers.name : "Organisation members"}
            </SheetTitle>
          </SheetHeader>

          {loadingOrgMembers ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 p-3 border border-border rounded-lg">
                  <Skeleton className="w-8 h-8 rounded-lg shrink-0" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-3.5 w-32" />
                    <Skeleton className="h-3 w-24" />
                  </div>
                </div>
              ))}
            </div>
          ) : orgWithMembers ? (
            <div className="space-y-5">
              {/* Org info */}
              {(orgWithMembers.address || orgWithMembers.phone || orgWithMembers.email) && (
                <div className="bg-muted/20 rounded-lg p-3 space-y-1 text-sm">
                  {orgWithMembers.address && <div className="text-muted-foreground text-xs">{orgWithMembers.address}</div>}
                  {(orgWithMembers.phone || orgWithMembers.email) && (
                    <div className="text-xs text-muted-foreground">
                      {[orgWithMembers.phone, orgWithMembers.email].filter(Boolean).join(" · ")}
                    </div>
                  )}
                </div>
              )}

              {/* Members list */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Members ({orgWithMembers.members.length})
                  </div>
                  {canEdit && (
                    <Button
                      type="button" variant="ghost" size="sm" className="h-7 text-xs gap-1"
                      onClick={() => { setAddingMemberToOrg(true); setNewOrgMemberCustomer(null); setCustomerSearchQuery(""); setCustomerSearchResults([]); }}
                    >
                      <PlusIcon className="w-3 h-3" /> Add member
                    </Button>
                  )}
                </div>

                {orgWithMembers.members.length === 0 && !addingMemberToOrg && (
                  <div className="text-xs text-muted-foreground text-center py-6 border border-dashed border-border rounded-lg">
                    No members yet — add customers to this organisation
                  </div>
                )}

                <div className="space-y-2">
                  {orgWithMembers.members.map((m) => (
                    <div key={m.membershipId} className="flex items-start justify-between p-3 border border-border rounded-lg">
                      <div className="flex items-start gap-2 min-w-0">
                        <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center text-xs font-medium shrink-0", getAvatarColor(m.customerName))}>
                          {getInitials(m.customerName)}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-sm font-medium truncate">
                              {[m.customerTitle, m.customerName].filter(Boolean).join(" ")}
                            </span>
                            {m.isPrimary && <span className="text-[10px] bg-primary/10 text-primary rounded px-1.5 py-0.5 shrink-0">Primary</span>}
                          </div>
                          {(m.position || m.department) && (
                            <div className="text-xs text-muted-foreground">{[m.position, m.department].filter(Boolean).join(" · ")}</div>
                          )}
                          {m.customerEmail && <div className="text-xs text-muted-foreground">{m.customerEmail}</div>}
                        </div>
                      </div>
                      {canEdit && (
                        <button
                          type="button"
                          onClick={() => handleRemoveMemberFromOrg(m.membershipId)}
                          className="p-1 text-muted-foreground hover:text-destructive transition-colors shrink-0 ml-2"
                          title="Remove from organisation"
                        >
                          <XIcon className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  ))}

                  {addingMemberToOrg && (
                    <div className="border border-border rounded-lg p-3 space-y-3">
                      <Field label="Search customer">
                        {newOrgMemberCustomer ? (
                          <div className="flex items-center gap-2 h-9 px-3 rounded-md border border-border bg-muted/20 text-sm">
                            <span className="flex-1 truncate">{newOrgMemberCustomer.name}</span>
                            <button type="button" onClick={() => { setNewOrgMemberCustomer(null); setCustomerSearchQuery(""); setCustomerSearchResults([]); }} className="text-muted-foreground hover:text-foreground">
                              <XIcon className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : (
                          <div className="relative">
                            <div className="relative">
                              <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                              <Input
                                value={customerSearchQuery}
                                onChange={(e) => handleCustomerSearch(e.target.value)}
                                placeholder="Type customer name…"
                                className="pl-9 h-9 text-sm"
                              />
                            </div>
                            {customerSearchQuery.length > 0 && (
                              <div className="absolute z-50 mt-1 w-full bg-background border border-border rounded-md shadow-md overflow-hidden">
                                {searchingCustomers ? (
                                  <div className="px-3 py-2 text-xs text-muted-foreground">Searching…</div>
                                ) : customerSearchResults.length === 0 ? (
                                  <div className="px-3 py-2 text-xs text-muted-foreground">No customers found</div>
                                ) : (
                                  customerSearchResults
                                    .filter((c) => !orgWithMembers.members.some((m) => m.customerId === c.id))
                                    .map((c) => (
                                      <button
                                        key={c.id}
                                        type="button"
                                        className="w-full text-left px-3 py-2 text-sm hover:bg-muted/40 flex items-center gap-2"
                                        onClick={() => { setNewOrgMemberCustomer({ id: c.id, name: [c.title, c.name].filter(Boolean).join(" ") }); setCustomerSearchQuery(""); setCustomerSearchResults([]); }}
                                      >
                                        <div className={cn("w-6 h-6 rounded flex items-center justify-center text-[10px] font-medium shrink-0", getAvatarColor(c.name))}>
                                          {getInitials(c.name)}
                                        </div>
                                        <span className="truncate">{[c.title, c.name].filter(Boolean).join(" ")}</span>
                                      </button>
                                    ))
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </Field>
                      <div className="grid grid-cols-2 gap-3">
                        <Field label="Position">
                          <Input value={newOrgMemberPosition} onChange={(e) => setNewOrgMemberPosition(e.target.value)} placeholder="e.g. Manager" className="h-9 text-sm" />
                        </Field>
                        <Field label="Department">
                          <Input value={newOrgMemberDept} onChange={(e) => setNewOrgMemberDept(e.target.value)} placeholder="e.g. Surgery" className="h-9 text-sm" />
                        </Field>
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" className="flex-1 h-8 text-xs" disabled={savingOrgMember} onClick={handleAddMemberToOrg}>
                          {savingOrgMember ? "Saving…" : "Add member"}
                        </Button>
                        <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => { setAddingMemberToOrg(false); setNewOrgMemberCustomer(null); setCustomerSearchQuery(""); setCustomerSearchResults([]); }}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}
