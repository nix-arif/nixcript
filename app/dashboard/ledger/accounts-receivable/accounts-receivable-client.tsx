"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  type ArBalanceRow,
  type ArTransactionRow,
  type ArReferenceData,
  getArTransactions,
  createArReceipt,
  getArOverview,
} from "@/server/accounts-receivable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { BookUserIcon, PlusIcon } from "lucide-react";
import { hasAccess } from "@/lib/permissions/has-access";

type Props = {
  initialBalances: ArBalanceRow[];
  refData: ArReferenceData | null;
  permissions: string[];
};

const fmtMYR = (n: number) =>
  new Intl.NumberFormat("en-MY", { style: "currency", currency: "MYR", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

const today = () => new Date().toISOString().split("T")[0];

export function AccountsReceivableClient({ initialBalances, refData, permissions }: Props) {
  const canCreate = hasAccess(permissions, "accounts-receivable:create") && !!refData;

  const [balances, setBalances] = useState(initialBalances);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [transactions, setTransactions] = useState<ArTransactionRow[] | null>(null);
  const [isPending, startTransition] = useTransition();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [date, setDate] = useState(today());
  const [customerId, setCustomerId] = useState("");
  const [bankAccountId, setBankAccountId] = useState("");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [invoiceId, setInvoiceId] = useState("");

  const total = balances.reduce((s, b) => s + parseFloat(b.balance), 0);

  function loadTransactions(customerId: string) {
    setSelectedCustomerId(customerId);
    startTransition(async () => {
      try {
        const data = await getArTransactions(customerId);
        setTransactions(data);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to load transactions");
      }
    });
  }

  async function refresh() {
    const [nextBalances, nextTransactions] = await Promise.all([
      getArOverview(),
      selectedCustomerId ? getArTransactions(selectedCustomerId) : Promise.resolve(null),
    ]);
    setBalances(nextBalances);
    if (nextTransactions) setTransactions(nextTransactions);
  }

  function resetForm() {
    setDate(today());
    setCustomerId("");
    setBankAccountId("");
    setAmount("");
    setDescription("");
    setInvoiceId("");
  }

  async function handleSubmit() {
    if (!date || !customerId || !bankAccountId || !amount) {
      toast.error("Date, customer, bank/cash account, and amount are required");
      return;
    }
    setSaving(true);
    try {
      await createArReceipt({
        date,
        customerId,
        bankAccountId,
        amount,
        description,
        invoiceId: invoiceId || undefined,
      });
      toast.success("Receipt recorded as draft — a ledger admin still needs to post it.");
      setDialogOpen(false);
      resetForm();
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to record receipt");
    } finally {
      setSaving(false);
    }
  }

  const customerInvoices = refData?.invoices.filter((i) => !customerId || i.customerId === customerId) ?? [];

  return (
    <div className="p-6 flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <BookUserIcon className="h-5 w-5 text-muted-foreground" />
            Accounts Receivable
          </h1>
          <p className="text-sm text-muted-foreground">Who owes the business money, and receipts recorded against it.</p>
        </div>

        {canCreate && (
          <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) resetForm(); }}>
            <DialogTrigger asChild>
              <Button className="gap-2">
                <PlusIcon className="w-4 h-4" /> Record Receipt
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Record Customer Receipt</DialogTitle>
              </DialogHeader>
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="date">Date *</Label>
                  <Input id="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Customer *</Label>
                  <Select value={customerId} onValueChange={(v) => { setCustomerId(v); setInvoiceId(""); }}>
                    <SelectTrigger><SelectValue placeholder="Select customer..." /></SelectTrigger>
                    <SelectContent>
                      {refData!.customers.map((c) => (
                        <SelectItem key={c.id} value={c.id}>{c.organizationName || c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Received Into *</Label>
                  <Select value={bankAccountId} onValueChange={setBankAccountId}>
                    <SelectTrigger><SelectValue placeholder="Select cash/bank account..." /></SelectTrigger>
                    <SelectContent>
                      {refData!.bankAccounts.map((a) => (
                        <SelectItem key={a.id} value={a.id}>{a.code} — {a.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="amount">Amount (MYR) *</Label>
                  <Input id="amount" type="number" step="0.01" min="0" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
                </div>
                {customerId && customerInvoices.length > 0 && (
                  <div className="flex flex-col gap-1.5">
                    <Label>Against Invoice (optional)</Label>
                    <Select value={invoiceId} onValueChange={setInvoiceId}>
                      <SelectTrigger><SelectValue placeholder="No specific invoice" /></SelectTrigger>
                      <SelectContent>
                        {customerInvoices.map((i) => (
                          <SelectItem key={i.id} value={i.id}>{i.invoiceNo}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="description">Notes</Label>
                  <Input id="description" placeholder="Optional note..." value={description} onChange={(e) => setDescription(e.target.value)} />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>Cancel</Button>
                <Button onClick={handleSubmit} disabled={saving}>{saving ? "Saving..." : "Save as Draft"}</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {/* Balances */}
      {balances.length === 0 ? (
        <div className="text-center text-muted-foreground py-12 border border-border rounded-lg">
          No posted receivable balances yet.
        </div>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40">
                <TableHead>Customer</TableHead>
                <TableHead className="text-right w-[160px]">Balance</TableHead>
                <TableHead className="w-[100px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {balances.map((b) => (
                <TableRow
                  key={b.stakeholderId}
                  className="cursor-pointer hover:bg-muted/30"
                  onClick={() => loadTransactions(b.stakeholderId)}
                  data-state={selectedCustomerId === b.stakeholderId ? "selected" : undefined}
                >
                  <TableCell className="text-sm font-medium flex items-center gap-2">
                    {b.stakeholderName}
                    {b.hasDraft && (
                      <Badge variant="outline" className="text-[10px] font-normal">Draft pending</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">{fmtMYR(parseFloat(b.balance))}</TableCell>
                  <TableCell className="text-right text-xs text-blue-600">View history</TableCell>
                </TableRow>
              ))}
              <TableRow className="bg-muted/30 font-semibold border-t-2 border-border">
                <TableCell className="text-sm pr-4 text-right">Total</TableCell>
                <TableCell className="text-right font-mono text-sm">{fmtMYR(total)}</TableCell>
                <TableCell />
              </TableRow>
            </TableBody>
          </Table>
        </div>
      )}

      {/* Transaction history for the selected customer */}
      {selectedCustomerId && (
        <div className="flex flex-col gap-2">
          <h2 className="font-medium text-sm">
            Transactions — {balances.find((b) => b.stakeholderId === selectedCustomerId)?.stakeholderName ?? ""}
          </h2>
          {isPending ? (
            <div className="text-center text-muted-foreground py-8">Loading...</div>
          ) : transactions && transactions.length === 0 ? (
            <div className="text-center text-muted-foreground py-8 border border-border rounded-lg">
              No transactions found for this customer.
            </div>
          ) : transactions ? (
            <div className="rounded-lg border border-border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40">
                    <TableHead>Date</TableHead>
                    <TableHead>Entry No.</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="text-right">Debit</TableHead>
                    <TableHead className="text-right">Credit</TableHead>
                    <TableHead className="w-[90px]">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {transactions.map((t) => (
                    <TableRow key={t.entryId}>
                      <TableCell className="text-xs">{t.date}</TableCell>
                      <TableCell className="text-xs font-mono">{t.entryNo}</TableCell>
                      <TableCell className="text-xs">{t.description}</TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {parseFloat(t.debit) > 0 ? fmtMYR(parseFloat(t.debit)) : "—"}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {parseFloat(t.credit) > 0 ? fmtMYR(parseFloat(t.credit)) : "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant={t.status === "POSTED" ? "default" : "outline"} className="text-[10px]">
                          {t.status === "POSTED" ? "Posted" : "Draft"}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
