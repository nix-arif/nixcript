"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  upsertOrganizationProfile,
  uploadOrganizationLogo,
  uploadOrgCertificate,
  getPresignedUrl,
  removeOrgCertificate,
} from "@/server/organization-profile";
import { FullOrganizationProfile } from "@/server/organization-profile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/page-header";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  SaveIcon,
  UploadIcon,
  FileTextIcon,
  PlusIcon,
  TrashIcon,
  EyeIcon,
  BuildingIcon,
  XIcon,
  StarIcon,
} from "lucide-react";
import { nanoid } from "nanoid";
import { cn } from "@/lib/utils";

type CertField =
  | "ssmCertUrl"
  | "taxCertUrl"
  | "mofCertUrl"
  | "pkkCertUrl"
  | "mdaCertUrl"
  | "bankStatementUrl"
  | "lampiran12Url"
  | "lampiran13Url";

interface BankEntry {
  id: string;
  bankName: string;
  branchName: string;
  accountHolder: string;
  accountNo: string;
  accountType: string;
  swiftCode: string;
  isPrimary: boolean;
}

interface Props {
  data: FullOrganizationProfile;
}

// ── Module-level components ────────────────────────────────────────────────

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-[11px] font-medium text-muted-foreground mb-1.5">
        {label}
      </label>
      {children}
    </div>
  );
}

function SectionHeader({
  icon: Icon,
  title,
  action,
}: {
  icon: any;
  title: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="px-4 py-3 border-b border-border bg-muted/20 flex items-center justify-between">
      <div className="flex items-center gap-2">
        <Icon className="w-3.5 h-3.5 text-muted-foreground" />
        <div className="text-xs font-medium">{title}</div>
      </div>
      {action}
    </div>
  );
}

function CertRow({
  label,
  field,
  currentKey,
  onUploaded,
  onRemove,
  onView,
  uploading,
}: {
  label: string;
  field: CertField;
  currentKey: string | null;
  onUploaded: (key: string) => void;
  onRemove: () => void;
  onView: () => void;
  uploading: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const filename = currentKey
    ? (currentKey.split("/").pop() ?? currentKey)
    : null;

  return (
    <div className="flex items-center justify-between p-2.5 border border-border rounded-lg bg-muted/30">
      <div className="flex items-center gap-2.5 min-w-0">
        <FileTextIcon className="w-4 h-4 text-muted-foreground shrink-0" />
        <div className="min-w-0">
          <div className="text-xs font-medium truncate">{label}</div>
          <div className="text-[11px] text-muted-foreground truncate">
            {filename ?? "Not uploaded"}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1.5 shrink-0 ml-2">
        {currentKey && (
          <>
            <Button
              variant="outline"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={onView}
            >
              <EyeIcon className="w-3 h-3" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
              onClick={onRemove}
            >
              <XIcon className="w-3 h-3" />
            </Button>
          </>
        )}
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1 text-xs"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
        >
          {uploading ? (
            <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
          ) : (
            <UploadIcon className="w-3 h-3" />
          )}
          {currentKey ? "Replace" : "Upload"}
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.jpg,.jpeg,.png"
          className="hidden"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            const formData = new FormData();
            formData.append("file", file);
            try {
              const key = await uploadOrgCertificate(formData, field);
              onUploaded(key);
              toast.success(`${label} uploaded`);
            } catch (err: any) {
              toast.error(err.message);
            }
            e.target.value = "";
          }}
        />
      </div>
    </div>
  );
}

// ── Main ───────────────────────────────────────────────────────────────────
export function OrganizationProfileClient({ data }: Props) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingCert, setUploadingCert] = useState<CertField | null>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);

  // Company identity
  const [companyName, setCompanyName] = useState(data.companyName ?? "");
  const [businessType, setBusinessType] = useState(data.businessType ?? "trading");
  const [companyAddress, setCompanyAddress] = useState(data.companyAddress ?? "");
  const [phone, setPhone] = useState(data.phone ?? "");
  const [email, setEmail] = useState(data.email ?? "");
  const [website, setWebsite] = useState(data.website ?? "");
  const [logoUrl, setLogoUrl] = useState(data.logo);

  // Registration & tax
  const [oldSsmNo, setOldSsmNo] = useState(data.oldSsmNo ?? "");
  const [newSsmNo, setNewSsmNo] = useState(data.newSsmNo ?? "");
  const [taxNo, setTaxNo] = useState(data.taxNo ?? "");

  // MOF & PKK
  const [mofNo, setMofNo] = useState(data.mofNo ?? "");
  const [mofValidity, setMofValidity] = useState(data.mofValidity?.slice(0, 10) ?? "");
  const [pkkNo, setPkkNo] = useState(data.pkkNo ?? "");

  // MDA
  const [mdaEstablishmentNo, setMdaEstablishmentNo] = useState(
    data.mdaEstablishmentNo ?? "",
  );
  const [mdaEstablishmentValidity, setMdaEstablishmentValidity] = useState(
    data.mdaEstablishmentValidity?.slice(0, 10) ?? "",
  );

  // Warehouse
  const [warehouseAddresses, setWarehouseAddresses] = useState(
    data.warehouseAddresses,
  );

  // Banking
  const [bankingInfo, setBankingInfo] = useState<BankEntry[]>(
    data.bankingInfo.map((b) => ({ ...b, branchName: b.branchName ?? "" })),
  );


  // Certificate keys
  const [ssmCertUrl, setSsmCertUrl] = useState(data.ssmCertKey);
  const [taxCertUrl, setTaxCertUrl] = useState(data.taxCertKey);
  const [mofCertUrl, setMofCertUrl] = useState(data.mofCertKey);
  const [pkkCertUrl, setPkkCertUrl] = useState(data.pkkCertKey);
  const [mdaCertUrl, setMdaCertUrl] = useState(data.mdaCertKey);
  const [bankStatementUrl, setBankStatementUrl] = useState(data.bankStatementKey);
  const [lampiran12Url, setLampiran12Url] = useState(data.lampiran12Key);
  const [lampiran13Url, setLampiran13Url] = useState(data.lampiran13Key);

  const certSetters: Record<CertField, (v: string | null) => void> = {
    ssmCertUrl: setSsmCertUrl,
    taxCertUrl: setTaxCertUrl,
    mofCertUrl: setMofCertUrl,
    pkkCertUrl: setPkkCertUrl,
    mdaCertUrl: setMdaCertUrl,
    bankStatementUrl: setBankStatementUrl,
    lampiran12Url: setLampiran12Url,
    lampiran13Url: setLampiran13Url,
  };

  const certValues: Record<CertField, string | null> = {
    ssmCertUrl,
    taxCertUrl,
    mofCertUrl,
    pkkCertUrl,
    mdaCertUrl,
    bankStatementUrl,
    lampiran12Url,
    lampiran13Url,
  };

  const handleViewCert = async (key: string) => {
    try {
      const url = await getPresignedUrl(key);
      window.open(url, "_blank");
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleRemoveCert = async (field: CertField) => {
    try {
      await removeOrgCertificate(field);
      certSetters[field](null);
      toast.success("Certificate removed");
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingLogo(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const url = await uploadOrganizationLogo(formData);
      setLogoUrl(url);
      toast.success("Logo updated");
      router.refresh();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setUploadingLogo(false);
      e.target.value = "";
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await upsertOrganizationProfile({
        companyName,
        businessType,
        companyAddress,
        phone: phone || null,
        email: email || null,
        website: website || null,
        oldSsmNo,
        newSsmNo,
        taxNo,
        mofNo,
        mofValidity: mofValidity || null,
        pkkNo,
        mdaEstablishmentNo,
        mdaEstablishmentValidity: mdaEstablishmentValidity || null,
        warehouseAddresses,
        bankingInfo,
      });
      toast.success("Organization profile saved");
      router.refresh();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  // ── Warehouse handlers ───────────────────────────────────────────────────
  const addWarehouse = () =>
    setWarehouseAddresses((p) => [...p, { label: "", address: "" }]);

  const updateWarehouse = (
    i: number,
    key: "label" | "address",
    value: string,
  ) =>
    setWarehouseAddresses((p) => {
      const n = [...p];
      n[i] = { ...n[i], [key]: value };
      return n;
    });

  const removeWarehouse = (i: number) =>
    setWarehouseAddresses((p) => p.filter((_, idx) => idx !== i));

  // ── Banking handlers ─────────────────────────────────────────────────────
  const addBank = () =>
    setBankingInfo((p) => [
      ...p,
      {
        id: nanoid(),
        bankName: "",
        branchName: "",
        accountHolder: "",
        accountNo: "",
        accountType: "current",
        swiftCode: "",
        isPrimary: p.length === 0, // first bank is primary
      },
    ]);

  const updateBank = (i: number, key: keyof BankEntry, value: any) =>
    setBankingInfo((p) => {
      const n = [...p];
      n[i] = { ...n[i], [key]: value };
      return n;
    });

  const setPrimaryBank = (i: number) =>
    setBankingInfo((p) => p.map((b, idx) => ({ ...b, isPrimary: idx === i })));

  const removeBank = (i: number) =>
    setBankingInfo((p) => {
      const filtered = p.filter((_, idx) => idx !== i);
      // If removed was primary, set first as primary
      if (p[i].isPrimary && filtered.length > 0) {
        filtered[0].isPrimary = true;
      }
      return filtered;
    });

  return (
    <div className="p-6">
      <PageHeader
        title="Organization profile"
        description="Manage company information, certificates and compliance documents"
        action={
          <Button onClick={handleSave} disabled={saving} className="gap-2">
            {saving ? (
              <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
            ) : (
              <SaveIcon className="w-3.5 h-3.5" />
            )}
            Save changes
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-4">
        {/* ── Company identity ─────────────────────────────────────────── */}
        <div className="bg-background border border-border rounded-xl overflow-hidden">
          <SectionHeader icon={BuildingIcon} title="Company identity" />
          <div className="p-4 space-y-4">
            <div className="flex items-center gap-4 pb-4 border-b border-border">
              <div className="w-16 h-16 rounded-lg border border-border bg-muted/30 flex items-center justify-center shrink-0 overflow-hidden">
                {logoUrl ? (
                  <img
                    src={logoUrl}
                    alt="Company logo"
                    className="w-full h-full object-contain p-1"
                  />
                ) : (
                  <BuildingIcon className="w-6 h-6 text-muted-foreground" />
                )}
              </div>
              <div>
                <div className="text-xs font-medium mb-1">Company logo</div>
                <div className="text-[11px] text-muted-foreground mb-2">
                  SVG format recommended
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1.5 text-xs"
                  disabled={uploadingLogo}
                  onClick={() => logoInputRef.current?.click()}
                >
                  {uploadingLogo ? (
                    <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <UploadIcon className="w-3 h-3" />
                  )}
                  {logoUrl ? "Replace logo" : "Upload logo"}
                </Button>
                <input
                  ref={logoInputRef}
                  type="file"
                  accept=".svg,.png,.jpg,.jpeg"
                  className="hidden"
                  onChange={handleLogoUpload}
                />
              </div>
            </div>
            <Field label="Company name">
              <Input
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="e.g. Bio Mech Supply Sdn. Bhd."
                className="h-9 text-sm"
              />
            </Field>
            <Field label="Business type">
              <div className="grid grid-cols-3 gap-2">
                {[
                  { id: "trading", label: "Trading", desc: "Resell finished goods as-is" },
                  { id: "oem", label: "OEM", desc: "Private-label sourcing only" },
                  { id: "both", label: "Both", desc: "Mix of trading & OEM" },
                ].map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setBusinessType(opt.id)}
                    className={cn(
                      "text-left px-3 py-2 rounded-lg border transition-colors",
                      businessType === opt.id
                        ? "border-primary bg-primary/5"
                        : "border-border hover:bg-muted/40",
                    )}
                  >
                    <div className="text-xs font-medium">{opt.label}</div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">{opt.desc}</div>
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground mt-1.5">
                Controls whether OEM sourcing fields (design reference, private-label emboss spec) appear in the product catalogue and sales order items.
              </p>
            </Field>
            <Field label="Company address">
              <textarea
                value={companyAddress}
                onChange={(e) => setCompanyAddress(e.target.value)}
                placeholder="Full company address"
                rows={4}
                className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background resize-none focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Phone / Contact No.">
                <Input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+60-11-12345678"
                  className="h-9 text-sm"
                />
              </Field>
              <Field label="Email">
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="info@company.com"
                  className="h-9 text-sm"
                />
              </Field>
            </div>
            <Field label="Website">
              <Input
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                placeholder="https://www.company.com"
                className="h-9 text-sm"
              />
            </Field>
          </div>
        </div>

        {/* ── Registration & Tax ───────────────────────────────────────── */}
        <div className="bg-background border border-border rounded-xl overflow-hidden">
          <SectionHeader icon={FileTextIcon} title="Registration & tax" />
          <div className="p-4 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Old SSM No.">
                <Input
                  value={oldSsmNo}
                  onChange={(e) => setOldSsmNo(e.target.value)}
                  placeholder="123456-X"
                  className="h-9 text-sm"
                />
              </Field>
              <Field label="New SSM No.">
                <Input
                  value={newSsmNo}
                  onChange={(e) => setNewSsmNo(e.target.value)}
                  placeholder="202301234567"
                  className="h-9 text-sm"
                />
              </Field>
            </div>
            <CertRow
              label="SSM Certificate"
              field="ssmCertUrl"
              currentKey={ssmCertUrl}
              uploading={uploadingCert === "ssmCertUrl"}
              onUploaded={(key) => {
                setSsmCertUrl(key);
                setUploadingCert(null);
              }}
              onRemove={() => handleRemoveCert("ssmCertUrl")}
              onView={() => ssmCertUrl && handleViewCert(ssmCertUrl)}
            />
            <Field label="Tax No. / TIN">
              <Input
                value={taxNo}
                onChange={(e) => setTaxNo(e.target.value)}
                placeholder="C1234567890"
                className="h-9 text-sm"
              />
            </Field>
            <CertRow
              label="Tax Certificate"
              field="taxCertUrl"
              currentKey={taxCertUrl}
              uploading={uploadingCert === "taxCertUrl"}
              onUploaded={(key) => {
                setTaxCertUrl(key);
                setUploadingCert(null);
              }}
              onRemove={() => handleRemoveCert("taxCertUrl")}
              onView={() => taxCertUrl && handleViewCert(taxCertUrl)}
            />
          </div>
        </div>

        {/* ── MOF & PKK ────────────────────────────────────────────────── */}
        <div className="bg-background border border-border rounded-xl overflow-hidden">
          <SectionHeader icon={FileTextIcon} title="MOF & PKK" />
          <div className="p-4 space-y-4">
            <Field label="MOF No.">
              <Input
                value={mofNo}
                onChange={(e) => setMofNo(e.target.value)}
                placeholder="MOF/123/2024"
                className="h-9 text-sm"
              />
            </Field>
            <Field label="MOF validity">
              <Input
                type="date"
                value={mofValidity}
                onChange={(e) => setMofValidity(e.target.value)}
                className="h-9 text-sm"
              />
            </Field>
            <CertRow
              label="MOF Certificate"
              field="mofCertUrl"
              currentKey={mofCertUrl}
              uploading={uploadingCert === "mofCertUrl"}
              onUploaded={(key) => {
                setMofCertUrl(key);
                setUploadingCert(null);
              }}
              onRemove={() => handleRemoveCert("mofCertUrl")}
              onView={() => mofCertUrl && handleViewCert(mofCertUrl)}
            />
            <Field label="PKK No.">
              <Input
                value={pkkNo}
                onChange={(e) => setPkkNo(e.target.value)}
                placeholder="PKK/B/12345"
                className="h-9 text-sm"
              />
            </Field>
            <CertRow
              label="PKK Certificate"
              field="pkkCertUrl"
              currentKey={pkkCertUrl}
              uploading={uploadingCert === "pkkCertUrl"}
              onUploaded={(key) => {
                setPkkCertUrl(key);
                setUploadingCert(null);
              }}
              onRemove={() => handleRemoveCert("pkkCertUrl")}
              onView={() => pkkCertUrl && handleViewCert(pkkCertUrl)}
            />
          </div>
        </div>

        {/* ── MDA Establishment ────────────────────────────────────────── */}
        <div className="bg-background border border-border rounded-xl overflow-hidden">
          <SectionHeader icon={FileTextIcon} title="MDA establishment" />
          <div className="p-4 space-y-4">
            <div className="bg-muted/30 border border-border rounded-lg p-3 text-xs text-muted-foreground leading-relaxed">
              MDA Establishment Registration is required for companies
              importing, exporting or distributing medical devices in Malaysia
              under the Medical Device Act 2012.
            </div>
            <Field label="MDA establishment registration no.">
              <Input
                value={mdaEstablishmentNo}
                onChange={(e) => setMdaEstablishmentNo(e.target.value)}
                placeholder="e.g. EST-2024-XXXXX"
                className="h-9 text-sm"
              />
            </Field>
            <Field label="MDA establishment validity">
              <Input
                type="date"
                value={mdaEstablishmentValidity}
                onChange={(e) => setMdaEstablishmentValidity(e.target.value)}
                className="h-9 text-sm"
              />
            </Field>
            <CertRow
              label="MDA certificate"
              field="mdaCertUrl"
              currentKey={mdaCertUrl}
              uploading={uploadingCert === "mdaCertUrl"}
              onUploaded={(key) => {
                setMdaCertUrl(key);
                setUploadingCert(null);
              }}
              onRemove={() => handleRemoveCert("mdaCertUrl")}
              onView={() => mdaCertUrl && handleViewCert(mdaCertUrl)}
            />
          </div>
        </div>

        {/* ── Warehouse addresses ──────────────────────────────────────── */}
        <div className="bg-background border border-border rounded-xl overflow-hidden">
          <SectionHeader
            icon={BuildingIcon}
            title="Warehouse addresses"
            action={
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1 text-xs"
                onClick={addWarehouse}
              >
                <PlusIcon className="w-3 h-3" /> Add
              </Button>
            }
          />
          <div className="p-4 space-y-3">
            {warehouseAddresses.length === 0 ? (
              <div
                onClick={addWarehouse}
                className="border border-dashed border-border rounded-lg p-5 text-center cursor-pointer hover:bg-muted/20 transition-colors"
              >
                <PlusIcon className="w-4 h-4 mx-auto mb-1.5 text-muted-foreground" />
                <div className="text-xs text-muted-foreground">
                  Add warehouse address
                </div>
              </div>
            ) : (
              <>
                {warehouseAddresses.map((w, i) => (
                  <div
                    key={i}
                    className="border border-border rounded-lg overflow-hidden"
                  >
                    <div className="flex items-center gap-2 px-3 py-2 bg-muted/20 border-b border-border">
                      <input
                        value={w.label}
                        onChange={(e) =>
                          updateWarehouse(i, "label", e.target.value)
                        }
                        placeholder="Label e.g. Main warehouse"
                        className="flex-1 bg-transparent text-xs font-medium outline-none placeholder:text-muted-foreground"
                      />
                      <button
                        onClick={() => removeWarehouse(i)}
                        className="text-muted-foreground hover:text-destructive transition-colors"
                      >
                        <TrashIcon className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <textarea
                      value={w.address}
                      onChange={(e) =>
                        updateWarehouse(i, "address", e.target.value)
                      }
                      placeholder="Full warehouse address"
                      rows={2}
                      className="w-full px-3 py-2 text-xs text-muted-foreground bg-transparent outline-none resize-none font-sans"
                    />
                  </div>
                ))}
                <div
                  onClick={addWarehouse}
                  className="border border-dashed border-border rounded-lg p-3 text-center cursor-pointer hover:bg-muted/20 transition-colors"
                >
                  <div className="text-xs text-muted-foreground flex items-center justify-center gap-1.5">
                    <PlusIcon className="w-3 h-3" /> Add another warehouse
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
        {/* ── Banking information ──────────────────────────────────────── */}
        <div className="bg-background border border-border rounded-xl overflow-hidden">
          <SectionHeader
            icon={BuildingIcon}
            title="Banking information"
            action={
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1 text-xs"
                onClick={addBank}
              >
                <PlusIcon className="w-3 h-3" /> Add bank
              </Button>
            }
          />
          <div className="p-4 space-y-3">
            {bankingInfo.length === 0 ? (
              <div
                onClick={addBank}
                className="border border-dashed border-border rounded-lg p-5 text-center cursor-pointer hover:bg-muted/20 transition-colors"
              >
                <PlusIcon className="w-4 h-4 mx-auto mb-1.5 text-muted-foreground" />
                <div className="text-xs text-muted-foreground">
                  Add bank account
                </div>
              </div>
            ) : (
              <>
                {bankingInfo.map((bank, i) => (
                  <div
                    key={bank.id}
                    className="border border-border rounded-lg overflow-hidden"
                  >
                    {/* Bank header */}
                    <div className="flex items-center gap-2 px-3 py-2 bg-muted/20 border-b border-border">
                      <Select
                        value={bank.bankName}
                        onValueChange={(v) => updateBank(i, "bankName", v)}
                      >
                        <SelectTrigger className="flex-1 h-7 border-0 bg-transparent shadow-none px-0 text-xs font-medium focus:ring-0">
                          <SelectValue placeholder="Select bank…" />
                        </SelectTrigger>
                        <SelectContent>
                          {[
                            "Maybank",
                            "CIMB Bank",
                            "Public Bank",
                            "RHB Bank",
                            "Hong Leong Bank",
                            "AmBank",
                            "Bank Islam Malaysia",
                            "Bank Rakyat",
                            "Affin Bank",
                            "Alliance Bank",
                            "OCBC Bank Malaysia",
                            "Standard Chartered Malaysia",
                            "HSBC Bank Malaysia",
                            "UOB Malaysia",
                            "Bank Simpanan Nasional (BSN)",
                            "Agrobank",
                            "Bank Muamalat Malaysia",
                            "MBSB Bank",
                            "Kuwait Finance House Malaysia",
                          ].map((b) => (
                            <SelectItem key={b} value={b}>{b}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {bank.isPrimary ? (
                          <span className="text-[10px] bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800 rounded px-1.5 py-0.5">
                            Primary
                          </span>
                        ) : (
                          <button
                            onClick={() => setPrimaryBank(i)}
                            className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
                            title="Set as primary"
                          >
                            <StarIcon className="w-3 h-3" /> Set primary
                          </button>
                        )}
                        <button
                          onClick={() => removeBank(i)}
                          className="text-muted-foreground hover:text-destructive transition-colors ml-1"
                        >
                          <TrashIcon className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Bank fields */}
                    <div className="p-3 grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[10px] font-medium text-muted-foreground mb-1">
                          Branch name
                        </label>
                        <input
                          value={bank.branchName}
                          onChange={(e) =>
                            updateBank(i, "branchName", e.target.value)
                          }
                          placeholder="e.g. Petaling Jaya"
                          className="w-full h-8 border border-input rounded-md px-2 text-xs bg-background outline-none focus:ring-1 focus:ring-ring"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-medium text-muted-foreground mb-1">
                          Account holder
                        </label>
                        <input
                          value={bank.accountHolder}
                          onChange={(e) =>
                            updateBank(i, "accountHolder", e.target.value)
                          }
                          placeholder="Account holder name"
                          className="w-full h-8 border border-input rounded-md px-2 text-xs bg-background outline-none focus:ring-1 focus:ring-ring"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-medium text-muted-foreground mb-1">
                          Account no.
                        </label>
                        <input
                          value={bank.accountNo}
                          onChange={(e) =>
                            updateBank(i, "accountNo", e.target.value)
                          }
                          placeholder="Account number"
                          className="w-full h-8 border border-input rounded-md px-2 text-xs bg-background font-mono outline-none focus:ring-1 focus:ring-ring"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-medium text-muted-foreground mb-1">
                          Account type
                        </label>
                        <Select
                          value={bank.accountType}
                          onValueChange={(v) => updateBank(i, "accountType", v)}
                        >
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="current">Current</SelectItem>
                            <SelectItem value="savings">Savings</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <label className="block text-[10px] font-medium text-muted-foreground mb-1">
                          Swift / BIC
                        </label>
                        <input
                          value={bank.swiftCode}
                          onChange={(e) =>
                            updateBank(i, "swiftCode", e.target.value)
                          }
                          placeholder="e.g. MBBEMYKL"
                          className="w-full h-8 border border-input rounded-md px-2 text-xs bg-background font-mono outline-none focus:ring-1 focus:ring-ring uppercase"
                        />
                      </div>
                    </div>
                  </div>
                ))}
                <div
                  onClick={addBank}
                  className="border border-dashed border-border rounded-lg p-3 text-center cursor-pointer hover:bg-muted/20 transition-colors"
                >
                  <div className="text-xs text-muted-foreground flex items-center justify-center gap-1.5">
                    <PlusIcon className="w-3 h-3" /> Add another bank account
                  </div>
                </div>
              </>
            )}
            <div className="pt-2 border-t border-border">
              <div className="text-[11px] font-medium text-muted-foreground mb-2">
                Bank statement
              </div>
              <CertRow
                label="Bank Statement"
                field="bankStatementUrl"
                currentKey={certValues.bankStatementUrl}
                uploading={uploadingCert === "bankStatementUrl"}
                onUploaded={(key) => {
                  certSetters.bankStatementUrl(key);
                  setUploadingCert(null);
                }}
                onRemove={() => handleRemoveCert("bankStatementUrl")}
                onView={() =>
                  certValues.bankStatementUrl &&
                  handleViewCert(certValues.bankStatementUrl)
                }
              />
            </div>
          </div>
        </div>

        {/* ── Compliance documents ─────────────────────────────────────── */}
        <div className="bg-background border border-border rounded-xl overflow-hidden">
          <SectionHeader icon={FileTextIcon} title="Compliance documents" />
          <div className="p-4 space-y-2">
            <p className="text-[11px] text-muted-foreground mb-3">
              Upload Lampiran 12 and Lampiran 13 to include them in quotation packages.
            </p>
            {(
              [
                { field: "lampiran12Url" as CertField, label: "Lampiran 12" },
                { field: "lampiran13Url" as CertField, label: "Lampiran 13" },
              ] as const
            ).map(({ field, label }) => (
              <CertRow
                key={field}
                label={label}
                field={field}
                currentKey={certValues[field]}
                uploading={uploadingCert === field}
                onUploaded={(key) => {
                  certSetters[field](key);
                  setUploadingCert(null);
                }}
                onRemove={() => handleRemoveCert(field)}
                onView={() => certValues[field] && handleViewCert(certValues[field]!)}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
