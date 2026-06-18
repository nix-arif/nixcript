"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  type LedgerAccountRow,
  createLedgerAccount,
  updateLedgerAccount,
  deleteLedgerAccount,
  seedDefaultLedgerAccounts,
} from "@/server/ledger";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import {
  PlusIcon,
  PencilIcon,
  TrashIcon,
  ToggleLeftIcon,
  ToggleRightIcon,
  LayoutListIcon,
  SparklesIcon,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────

type Props = {
  accounts: LedgerAccountRow[];
  permissions: string[];
};

const ACCOUNT_TYPES = [
  { value: "ASSET", label: "Assets" },
  { value: "LIABILITY", label: "Liabilities" },
  { value: "EQUITY", label: "Equity" },
  { value: "REVENUE", label: "Revenue" },
  { value: "EXPENSE", label: "Expenses" },
];

const TYPE_ORDER = ["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"];

function NormalBalanceBadge({ nb }: { nb: string }) {
  return nb === "DEBIT" ? (
    <Badge className="bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 border-0 text-xs">
      Debit
    </Badge>
  ) : (
    <Badge className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 border-0 text-xs">
      Credit
    </Badge>
  );
}

// ── Component ──────────────────────────────────────────────────────────────

export function AccountsClient({ accounts, permissions }: Props) {
  const router = useRouter();
  const canCreate = permissions.includes("*") || permissions.includes("account:create");
  const canUpdate = permissions.includes("*") || permissions.includes("account:update");
  const canDelete = permissions.includes("*") || permissions.includes("account:delete");

  // Create dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const [newCode, setNewCode] = useState("");
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState("");
  const [newSubtype, setNewSubtype] = useState("");
  const [newDescription, setNewDescription] = useState("");

  // Edit dialog
  const [editOpen, setEditOpen] = useState(false);
  const [editLoading, setEditLoading] = useState(false);
  const [editingAccount, setEditingAccount] = useState<LedgerAccountRow | null>(null);
  const [editName, setEditName] = useState("");
  const [editSubtype, setEditSubtype] = useState("");
  const [editDescription, setEditDescription] = useState("");

  // Delete confirm
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // Toggle loading
  const [togglingId, setTogglingId] = useState<string | null>(null);

  // Seed default COA
  const [seedLoading, setSeedLoading] = useState(false);

  const grouped = useMemo(() => {
    const map: Record<string, LedgerAccountRow[]> = {};
    for (const acc of accounts) {
      if (!map[acc.type]) map[acc.type] = [];
      map[acc.type].push(acc);
    }
    return map;
  }, [accounts]);

  async function handleCreate() {
    if (!newCode.trim() || !newName.trim() || !newType) {
      toast.error("Code, Name, and Type are required");
      return;
    }
    setCreateLoading(true);
    try {
      await createLedgerAccount({
        code: newCode.trim(),
        name: newName.trim(),
        type: newType,
        subtype: newSubtype.trim() || undefined,
        description: newDescription.trim() || undefined,
      });
      toast.success("Account created");
      setCreateOpen(false);
      setNewCode(""); setNewName(""); setNewType(""); setNewSubtype(""); setNewDescription("");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create account");
    } finally {
      setCreateLoading(false);
    }
  }

  function openEdit(acc: LedgerAccountRow) {
    setEditingAccount(acc);
    setEditName(acc.name);
    setEditSubtype(acc.subtype ?? "");
    setEditDescription(acc.description ?? "");
    setEditOpen(true);
  }

  async function handleEdit() {
    if (!editingAccount) return;
    if (!editName.trim()) { toast.error("Name is required"); return; }
    setEditLoading(true);
    try {
      await updateLedgerAccount(editingAccount.id, {
        name: editName.trim(),
        subtype: editSubtype.trim() || undefined,
        description: editDescription.trim() || undefined,
      });
      toast.success("Account updated");
      setEditOpen(false);
      setEditingAccount(null);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update account");
    } finally {
      setEditLoading(false);
    }
  }

  async function handleToggle(acc: LedgerAccountRow) {
    setTogglingId(acc.id);
    try {
      await updateLedgerAccount(acc.id, { isActive: !acc.isActive });
      toast.success(acc.isActive ? "Account deactivated" : "Account activated");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update account");
    } finally {
      setTogglingId(null);
    }
  }

  async function handleSeedDefaults() {
    setSeedLoading(true);
    try {
      const { inserted, skipped } = await seedDefaultLedgerAccounts();
      if (inserted === 0) {
        toast.success(`All default accounts already exist (${skipped} skipped)`);
      } else {
        toast.success(`Seeded ${inserted} default account${inserted !== 1 ? "s" : ""}${skipped > 0 ? ` (${skipped} already existed)` : ""}`);
      }
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to seed accounts");
    } finally {
      setSeedLoading(false);
    }
  }

  async function handleDelete() {
    if (!deleteId) return;
    setDeleteLoading(true);
    try {
      await deleteLedgerAccount(deleteId);
      toast.success("Account deleted");
      setDeleteId(null);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete account");
    } finally {
      setDeleteLoading(false);
    }
  }

  return (
    <div className="p-6 flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <LayoutListIcon className="h-5 w-5 text-muted-foreground" />
            Chart of Accounts
          </h1>
          <p className="text-sm text-muted-foreground">
            Manage your organization&apos;s chart of accounts.
          </p>
        </div>
        {canCreate && (
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={handleSeedDefaults}
              disabled={seedLoading}
            >
              <SparklesIcon className="h-4 w-4 mr-1" />
              {seedLoading ? "Seeding..." : "Seed Default COA"}
            </Button>
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <PlusIcon className="h-4 w-4 mr-1" />
              New Account
            </Button>
          </div>
        )}
      </div>

      {/* Grouped Tables */}
      {TYPE_ORDER.filter((t) => grouped[t]?.length).map((type) => {
        const typeLabel = ACCOUNT_TYPES.find((a) => a.value === type)?.label ?? type;
        return (
          <div key={type} className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              {typeLabel}
            </h2>
            <div className="rounded-lg border border-border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40">
                    <TableHead className="w-[100px]">Code</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Subtype</TableHead>
                    <TableHead className="w-[110px]">Normal Balance</TableHead>
                    <TableHead className="w-[80px]">Active</TableHead>
                    {(canUpdate || canDelete) && <TableHead className="w-[120px]">Actions</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(grouped[type] ?? []).map((acc) => (
                    <TableRow key={acc.id} className={!acc.isActive ? "opacity-50" : undefined}>
                      <TableCell className="font-mono text-xs font-medium">{acc.code}</TableCell>
                      <TableCell className="text-sm">{acc.name}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {acc.subtype ?? "—"}
                      </TableCell>
                      <TableCell>
                        <NormalBalanceBadge nb={acc.normalBalance} />
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={acc.isActive ? "outline" : "secondary"}
                          className="text-xs"
                        >
                          {acc.isActive ? "Active" : "Inactive"}
                        </Badge>
                      </TableCell>
                      {(canUpdate || canDelete) && (
                        <TableCell>
                          <div className="flex items-center gap-1">
                            {canUpdate && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2"
                                onClick={() => openEdit(acc)}
                              >
                                <PencilIcon className="h-3.5 w-3.5" />
                              </Button>
                            )}
                            {canUpdate && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2"
                                disabled={togglingId === acc.id}
                                onClick={() => handleToggle(acc)}
                                title={acc.isActive ? "Deactivate" : "Activate"}
                              >
                                {acc.isActive ? (
                                  <ToggleRightIcon className="h-3.5 w-3.5 text-green-600" />
                                ) : (
                                  <ToggleLeftIcon className="h-3.5 w-3.5 text-muted-foreground" />
                                )}
                              </Button>
                            )}
                            {canDelete && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-destructive hover:text-destructive"
                                onClick={() => setDeleteId(acc.id)}
                              >
                                <TrashIcon className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        );
      })}

      {accounts.length === 0 && (
        <div className="text-center text-muted-foreground py-12">
          No accounts found. Create your first account to get started.
        </div>
      )}

      {/* Create Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Account</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="newCode">Code *</Label>
                <Input
                  id="newCode"
                  placeholder="e.g. 1100"
                  value={newCode}
                  onChange={(e) => setNewCode(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="newType">Type *</Label>
                <Select value={newType} onValueChange={setNewType}>
                  <SelectTrigger id="newType">
                    <SelectValue placeholder="Select type..." />
                  </SelectTrigger>
                  <SelectContent>
                    {ACCOUNT_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="newName">Name *</Label>
              <Input
                id="newName"
                placeholder="e.g. Cash on Hand"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="newSubtype">Subtype</Label>
              <Input
                id="newSubtype"
                placeholder="e.g. CASH, BANK, ACCOUNTS_RECEIVABLE"
                value={newSubtype}
                onChange={(e) => setNewSubtype(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="newDescription">Description</Label>
              <Input
                id="newDescription"
                placeholder="Optional description..."
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
              />
            </div>
            {newType && (
              <p className="text-xs text-muted-foreground">
                Normal balance:{" "}
                <span className="font-medium">
                  {["ASSET", "EXPENSE"].includes(newType) ? "Debit" : "Credit"}
                </span>
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={createLoading}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={createLoading || !newCode.trim() || !newName.trim() || !newType}>
              {createLoading ? "Creating..." : "Create Account"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Account — {editingAccount?.code}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="editName">Name *</Label>
              <Input
                id="editName"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="editSubtype">Subtype</Label>
              <Input
                id="editSubtype"
                placeholder="e.g. CASH, BANK..."
                value={editSubtype}
                onChange={(e) => setEditSubtype(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="editDescription">Description</Label>
              <Input
                id="editDescription"
                placeholder="Optional description..."
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)} disabled={editLoading}>
              Cancel
            </Button>
            <Button onClick={handleEdit} disabled={editLoading || !editName.trim()}>
              {editLoading ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm Dialog */}
      <Dialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Account</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground py-2">
            Are you sure you want to delete this account? If it has been used in any journal
            entries, the deletion will fail. Consider deactivating instead.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteId(null)} disabled={deleteLoading}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleteLoading}>
              {deleteLoading ? "Deleting..." : "Delete Account"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
