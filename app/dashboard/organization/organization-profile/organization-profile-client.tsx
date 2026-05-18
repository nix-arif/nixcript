"use client";

import { useState, useRef } from "react";
import { toast } from "sonner";
import {
  upsertOrganizationProfile,
  uploadOrganizationLogo,
  uploadOrgCertificate,
  getPresignedUrl,
  removeOrgCertificate,
} from "@/server/organization-profile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  SaveIcon,
  UploadIcon,
  FileTextIcon,
  PlusIcon,
  TrashIcon,
  EyeIcon,
  BuildingIcon,
  XIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getOrganizationWithProfile } from "@/server/organization-profile";
import { useRouter } from "next/navigation";

type Org = Awaited<ReturnType<typeof getOrganizationWithProfile>>["org"];
type Profile = Awaited<
  ReturnType<typeof getOrganizationWithProfile>
>["profile"];
type CertField = "ssmCertUrl" | "taxCertUrl" | "mofCertUrl" | "pkkCertUrl";

interface WarehouseAddress {
  label: string;
  address: string;
}

interface Props {
  org: Org;
  profile: Profile;
}

// ── Certificate upload row ─────────────────────────────────────────────────
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
            {filename ? filename : "Not uploaded"}
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

function SectionHeader({ icon: Icon, title }: { icon: any; title: string }) {
  return (
    <div className="px-4 py-3 border-b border-border bg-muted/20 flex items-center gap-2">
      <Icon className="w-3.5 h-3.5 text-muted-foreground" />
      <div className="text-xs font-medium">{title}</div>
    </div>
  );
}

// ── Main ───────────────────────────────────────────────────────────────────
export function OrganizationProfileClient({ org, profile }: Props) {
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingCert, setUploadingCert] = useState<CertField | null>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);

  // Form state
  const [companyName, setCompanyName] = useState(
    profile?.companyName ?? org.name ?? "",
  );
  const [companyAddress, setCompanyAddress] = useState(
    profile?.companyAddress ?? "",
  );
  const [oldSsmNo, setOldSsmNo] = useState(profile?.oldSsmNo ?? "");
  const [newSsmNo, setNewSsmNo] = useState(profile?.newSsmNo ?? "");
  const [taxNo, setTaxNo] = useState(profile?.taxNo ?? "");
  const [mofNo, setMofNo] = useState(profile?.mofNo ?? "");
  const [mofValidity, setMofValidity] = useState(profile?.mofValidity ?? "");
  const [pkkNo, setPkkNo] = useState(profile?.pkkNo ?? "");
  const [warehouseAddresses, setWarehouseAddresses] = useState<
    WarehouseAddress[]
  >((profile?.warehouseAddresses as WarehouseAddress[]) ?? []);

  // Certificate keys
  const [ssmCertUrl, setSsmCertUrl] = useState(profile?.ssmCertUrl ?? null);
  const [taxCertUrl, setTaxCertUrl] = useState(profile?.taxCertUrl ?? null);
  const [mofCertUrl, setMofCertUrl] = useState(profile?.mofCertUrl ?? null);
  const [pkkCertUrl, setPkkCertUrl] = useState(profile?.pkkCertUrl ?? null);
  const router = useRouter();

  // Logo
  const [logoUrl, setLogoUrl] = useState(org.logo ?? null);

  const certSetters: Record<CertField, (v: string | null) => void> = {
    ssmCertUrl: setSsmCertUrl,
    taxCertUrl: setTaxCertUrl,
    mofCertUrl: setMofCertUrl,
    pkkCertUrl: setPkkCertUrl,
  };

  const certValues: Record<CertField, string | null> = {
    ssmCertUrl,
    taxCertUrl,
    mofCertUrl,
    pkkCertUrl,
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
      router.refresh(); // ← refresh to reflect logo change in switcher
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
        companyAddress,
        oldSsmNo,
        newSsmNo,
        taxNo,
        mofNo,
        mofValidity,
        pkkNo,
        warehouseAddresses,
      });
      toast.success("Organization profile saved");
      router.refresh(); // ← refresh to reflect name change in switcher
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const addWarehouse = () =>
    setWarehouseAddresses((prev) => [...prev, { label: "", address: "" }]);

  const updateWarehouse = (
    i: number,
    key: keyof WarehouseAddress,
    value: string,
  ) =>
    setWarehouseAddresses((prev) => {
      const n = [...prev];
      n[i] = { ...n[i], [key]: value };
      return n;
    });

  const removeWarehouse = (i: number) =>
    setWarehouseAddresses((prev) => prev.filter((_, idx) => idx !== i));

  return (
    <div className="p-6 max-w-5xl">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            Organization profile
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage company information, certificates and compliance documents
          </p>
        </div>
        <Button onClick={handleSave} disabled={saving} className="gap-2">
          {saving ? (
            <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
          ) : (
            <SaveIcon className="w-3.5 h-3.5" />
          )}
          Save changes
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* Company identity */}
        <div className="bg-background border border-border rounded-xl overflow-hidden">
          <SectionHeader icon={BuildingIcon} title="Company identity" />
          <div className="p-4 space-y-4">
            {/* Logo */}
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

            <Field label="Company address">
              <textarea
                value={companyAddress}
                onChange={(e) => setCompanyAddress(e.target.value)}
                placeholder="Full company address"
                rows={4}
                className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background resize-none focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </Field>
          </div>
        </div>

        {/* Registration & Tax */}
        <div className="bg-background border border-border rounded-xl overflow-hidden">
          <SectionHeader icon={FileTextIcon} title="Registration & tax" />
          <div className="p-4 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Old SSM No.">
                <Input
                  value={oldSsmNo}
                  onChange={(e) => setOldSsmNo(e.target.value)}
                  placeholder="e.g. 123456-X"
                  className="h-9 text-sm"
                />
              </Field>
              <Field label="New SSM No.">
                <Input
                  value={newSsmNo}
                  onChange={(e) => setNewSsmNo(e.target.value)}
                  placeholder="e.g. 202301234567"
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
                placeholder="e.g. C1234567890"
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

        {/* MOF & PKK */}
        <div className="bg-background border border-border rounded-xl overflow-hidden">
          <SectionHeader icon={FileTextIcon} title="MOF & PKK" />
          <div className="p-4 space-y-4">
            <Field label="MOF No.">
              <Input
                value={mofNo}
                onChange={(e) => setMofNo(e.target.value)}
                placeholder="e.g. MOF/123/2024"
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
                placeholder="e.g. PKK/B/12345"
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

        {/* Warehouse addresses */}
        <div className="bg-background border border-border rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-border bg-muted/20 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="text-xs font-medium">Warehouse addresses</div>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1 text-xs"
              onClick={addWarehouse}
            >
              <PlusIcon className="w-3 h-3" /> Add
            </Button>
          </div>
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
      </div>
    </div>
  );
}
