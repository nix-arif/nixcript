"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { upsertOrganizationProfile, FullOrganizationProfile } from "@/server/organization-profile";
import { upsertDocumentNumberingSettings, type NumberingSetting } from "@/server/document-numbering";
import { buildDocumentNo, DOC_TYPE_DEFAULTS } from "@/lib/document-numbering";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SaveIcon } from "lucide-react";
import { cn } from "@/lib/utils";

// ── Types ──────────────────────────────────────────────────────────────────
type ConfigurableDocType = "so" | "po" | "do" | "inv";
const DOC_TYPES: ConfigurableDocType[] = ["so", "po", "do", "inv"];

interface NumberingState {
  prefix: string;
  docCode: string;
  separator: string;
  includeYear: boolean;
  paddingLength: number;
  numberFormat: "standard" | "compact";
}

function makeDefaultNumberingState(
  docType: ConfigurableDocType,
  existing: NumberingSetting | undefined,
  orgSlug: string,
): NumberingState {
  return {
    prefix:        existing?.prefix        ?? orgSlug.toUpperCase(),
    docCode:       existing?.docCode       ?? DOC_TYPE_DEFAULTS[docType].docCode,
    separator:     existing?.separator     ?? "-",
    includeYear:   existing ? existing.includeYear === 1 : true,
    paddingLength: existing?.paddingLength ?? 4,
    numberFormat:  (existing?.numberFormat as "standard" | "compact") ?? "standard",
  };
}

interface Props {
  data: FullOrganizationProfile;
  numberingSettings: NumberingSetting[];
}

type Tab = "template" | "header" | "table" | "numbering";

// ── Small helpers ──────────────────────────────────────────────────────────
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground mb-2">{label}</p>
      {children}
    </div>
  );
}

function Pills<T extends string>({
  options, value, onChange,
}: {
  options: { id: T; label: string; sub?: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={o.id} type="button"
          onClick={() => onChange(o.id)}
          className={cn(
            "px-3 py-1.5 rounded-md border text-xs font-medium transition-colors",
            value === o.id
              ? "border-primary bg-primary/8 text-primary"
              : "border-border text-muted-foreground hover:bg-muted/40 hover:text-foreground",
          )}
        >
          {o.label}
          {o.sub && <span className="ml-1 text-[10px] opacity-60">{o.sub}</span>}
        </button>
      ))}
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) {
  return (
    <button
      type="button" onClick={onChange}
      className={cn(
        "px-3 py-1.5 rounded-md border text-xs font-medium transition-colors",
        checked
          ? "border-primary bg-primary/8 text-primary"
          : "border-border text-muted-foreground hover:bg-muted/40",
      )}
    >
      {label}
    </button>
  );
}

function Switch({ label, desc, checked, onChange }: { label: string; desc?: string; checked: boolean; onChange: () => void }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5 border-b border-border last:border-0">
      <div>
        <p className="text-xs font-medium">{label}</p>
        {desc && <p className="text-[11px] text-muted-foreground mt-0.5">{desc}</p>}
      </div>
      <button
        type="button" role="switch" aria-checked={checked} onClick={onChange}
        className={cn(
          "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors",
          checked ? "bg-primary" : "bg-muted",
        )}
      >
        <span className={cn(
          "pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow ring-0 transition-transform",
          checked ? "translate-x-4" : "translate-x-0",
        )} />
      </button>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────
export function DocumentSettingsClient({ data, numberingSettings }: Props) {
  const router = useRouter();
  const [saving, setSaving]     = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>("template");

  // ── Numbering ──────────────────────────────────────────────────────────
  const orgSlug = (data.slug ?? "ORG").slice(0, 3);
  const [numbering, setNumbering] = useState<Record<ConfigurableDocType, NumberingState>>(() => {
    const byType = Object.fromEntries(numberingSettings.map((s) => [s.documentType, s])) as Record<string, NumberingSetting>;
    return {
      so:  makeDefaultNumberingState("so",  byType["so"],  orgSlug),
      po:  makeDefaultNumberingState("po",  byType["po"],  orgSlug),
      do:  makeDefaultNumberingState("do",  byType["do"],  orgSlug),
      inv: makeDefaultNumberingState("inv", byType["inv"], orgSlug),
    };
  });

  function updateNumbering(docType: ConfigurableDocType, patch: Partial<NumberingState>) {
    setNumbering((prev) => ({ ...prev, [docType]: { ...prev[docType], ...patch } }));
  }

  // ── Branding ───────────────────────────────────────────────────────────
  const [brandColor,       setBrandColor]       = useState(data.brandColor       ?? "#1a56db");
  const [slateTextColor,   setSlateTextColor]   = useState(data.slateTextColor   ?? "");
  const [slateHeadingColor, setSlateHeadingColor] = useState(data.slateHeadingColor ?? "");

  // ── Template ───────────────────────────────────────────────────────────
  const [pdfTemplate, setPdfTemplate] = useState(data.pdfTemplate ?? "affirma");

  // Mono is black & white — previews should reflect the actual output colour
  const previewColor = pdfTemplate === "mono" ? "#000000" : brandColor;

  // ── Header ────────────────────────────────────────────────────────────
  const [headerLayout,         setHeaderLayout]         = useState(data.headerLayout         ?? "standard");
  const [orgNameSize,          setOrgNameSize]          = useState(data.orgNameSize          ?? "medium");
  const [orgNameBold,          setOrgNameBold]          = useState(!!(data.orgNameBold        ?? 1));
  const [orgNameUppercase,     setOrgNameUppercase]     = useState(!!(data.orgNameUppercase   ?? 0));
  const [quotationLabelSize,   setQuotationLabelSize]   = useState(data.quotationLabelSize   ?? "normal");
  const [quotationLabelBold,   setQuotationLabelBold]   = useState(!!(data.quotationLabelBold ?? 1));
  const [quotationLabelUppercase, setQuotationLabelUppercase] = useState(!!(data.quotationLabelUppercase ?? 1));
  const [quotationLabelAlign, setQuotationLabelAlign]   = useState<"left" | "center" | "right">((data.quotationLabelAlign as any) ?? "right");

  // ── Table ─────────────────────────────────────────────────────────────
  const [tableFontSize,   setTableFontSize]   = useState(data.tableFontSize   ?? "normal");
  const [showCodeColumn,  setShowCodeColumn]  = useState(!!(data.showCodeColumn ?? 1));
  const [tableRowStyle,   setTableRowStyle]   = useState(data.tableRowStyle   ?? "default");
  const [titlePosition,   setTitlePosition]   = useState(data.titlePosition   ?? "stamp");

  // ── Quotation format ───────────────────────────────────────────────────
  const [quotationNoFormat, setQuotationNoFormat] = useState(data.quotationNoFormat ?? "A");

  // ── Save ───────────────────────────────────────────────────────────────
  const handleSave = async () => {
    setSaving(true);
    try {
      const templateStyle =
        pdfTemplate === "nexus" || pdfTemplate === "zinc" ? "modern"
        : pdfTemplate === "slate" ? "bold"
        : pdfTemplate === "mono"  ? "mono"
        : "corporate";

      await Promise.all([
        upsertDocumentNumberingSettings(
          DOC_TYPES.map((dt) => ({
            documentType:  dt,
            prefix:        numbering[dt].prefix.trim(),
            docCode:       numbering[dt].docCode.trim().toUpperCase(),
            separator:     numbering[dt].separator || "-",
            includeYear:   numbering[dt].includeYear ? 1 : 0,
            paddingLength: numbering[dt].paddingLength,
            numberFormat:  numbering[dt].numberFormat,
          })),
        ),
        upsertOrganizationProfile({
          brandColor,
          slateTextColor:    slateTextColor    || null,
          slateHeadingColor: slateHeadingColor || null,
          slateInfoFontSize: data.slateInfoFontSize || null,
          pdfTemplate,
          templateStyle,
          headerLayout,
          orgNameSize,
          orgNameBold:           orgNameBold           ? 1 : 0,
          orgNameUppercase:      orgNameUppercase      ? 1 : 0,
          orgInfoSide:           data.orgInfoSide      ?? "left",
          quotationLabelSize,
          quotationLabelBold:      quotationLabelBold      ? 1 : 0,
          quotationLabelUppercase: quotationLabelUppercase ? 1 : 0,
          quotationLabelAlign,
          tableRowStyle,
          showCodeColumn:        showCodeColumn        ? 1 : 0,
          tableFontSize,
          titlePosition,
          quotationNoFormat,
          attentionNameSize:     data.attentionNameSize   ?? "medium",
          attentionNameBold:     (data.attentionNameBold  ?? 1),
          detailFontSize:        data.detailFontSize      ?? "normal",
          detailFontBold:        (data.detailFontBold     ?? 0),
          detailAlignment:       data.detailAlignment     ?? "right",
        }),
      ]);
      toast.success("Settings saved");
      router.refresh();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  // ── Quotation number preview ───────────────────────────────────────────
  const now   = new Date();
  const year  = now.getFullYear();
  const mm    = String(now.getMonth() + 1).padStart(2, "0");
  const yy    = String(year).slice(-2);
  const slug  = orgSlug.toUpperCase();
  const initials = (data.companyName ?? data.name ?? "ORG")
    .split(/\s+/).filter(Boolean).map((w: string) => w[0]).join("").toUpperCase();

  const quotationFormats = [
    { id: "A", preview: `${slug}-QT-${year}-0001`,                       desc: "Slug · QT · Year · Counter" },
    { id: "B", preview: `Q${slug}-${mm}${yy}-00001`,                     desc: "Q+Slug · Month-Year · Counter" },
    { id: "C", preview: `QT-${initials}-${year}-000001`,                 desc: "QT · Initials · Year · Counter" },
  ];

  // ── Template cards ─────────────────────────────────────────────────────
  const templates: { id: string; label: string; desc: string; preview: ReactNode }[] = [
    {
      id: "affirma", label: "Affirma", desc: "Bordered stamp · alternating rows",
      preview: (
        <div className="w-full h-10 rounded overflow-hidden flex flex-col" style={{ border: `1.5px solid ${brandColor}` }}>
          <div className="flex gap-1 p-1 bg-white">
            <div className="flex flex-col gap-0.5 flex-1">
              <div className="h-1 rounded-sm w-3/4" style={{ backgroundColor: brandColor, opacity: 0.7 }} />
              <div className="h-0.5 rounded-sm w-1/2 bg-gray-200" />
            </div>
            <div className="w-5 border rounded-sm shrink-0" style={{ borderColor: brandColor }} />
          </div>
          <div className="flex-1 space-y-px px-1 pb-0.5 bg-white">
            <div className="h-1.5 rounded-sm bg-blue-50" />
            <div className="h-1.5 rounded-sm bg-white" />
            <div className="h-1.5 rounded-sm bg-blue-50" />
          </div>
        </div>
      ),
    },
    {
      id: "nexus", label: "Nexus", desc: "Full-bleed header · clean rows",
      preview: (
        <div className="w-full h-10 rounded overflow-hidden flex flex-col">
          <div className="h-3.5 w-full px-1 flex items-center" style={{ backgroundColor: brandColor }}>
            <div className="h-1 w-3/4 bg-white/40 rounded-sm" />
          </div>
          <div className="flex-1 space-y-px px-1 pt-0.5 bg-white">
            <div className="h-1.5 rounded-sm bg-gray-50 border-b border-gray-100" />
            <div className="h-1.5 rounded-sm bg-white border-b border-gray-100" />
            <div className="h-1.5 rounded-sm bg-gray-50" />
          </div>
        </div>
      ),
    },
    {
      id: "slate", label: "Slate", desc: "Typographic · badge rows",
      preview: (
        <div className="w-full h-10 rounded overflow-hidden flex flex-col bg-white">
          <div className="h-1 w-full" style={{ backgroundColor: brandColor }} />
          <div className="px-1 pt-0.5 flex items-center gap-1">
            <div className="h-1.5 w-3/4" style={{ backgroundColor: brandColor, opacity: 0.8 }} />
            <div className="w-3 h-2.5 border-t-2 ml-auto" style={{ borderColor: brandColor }} />
          </div>
          <div className="flex-1 space-y-px px-1 pt-0.5">
            {[0, 1, 2].map(i => (
              <div key={i} className="flex items-center gap-1 h-1.5">
                <div className="w-1.5 h-1.5 rounded-sm shrink-0" style={{ backgroundColor: brandColor }} />
                <div className="h-0.5 flex-1 bg-gray-200" />
              </div>
            ))}
          </div>
        </div>
      ),
    },
    {
      id: "aura", label: "Aura", desc: "Editorial · floating header",
      preview: (
        <div className="w-full h-10 rounded overflow-hidden flex flex-col bg-white">
          <div className="h-0.5 w-full" style={{ backgroundColor: brandColor }} />
          <div className="px-1 pt-1 flex justify-between items-start flex-1">
            <div className="flex flex-col gap-0.5">
              <div className="h-1 rounded-sm w-10" style={{ backgroundColor: brandColor }} />
              <div className="h-0.5 rounded-sm w-6 bg-gray-200" />
            </div>
            <div className="flex flex-col gap-0.5 items-end">
              <div className="h-0.5 rounded-sm w-4 bg-gray-200" />
              <div className="h-1 rounded-sm w-6" style={{ backgroundColor: brandColor, opacity: 0.7 }} />
            </div>
          </div>
          <div className="border-t px-1 pb-0.5 space-y-px" style={{ borderColor: brandColor }}>
            <div className="h-1 rounded-sm bg-gray-100" />
            <div className="h-1 rounded-sm bg-white" />
          </div>
        </div>
      ),
    },
    {
      id: "zinc", label: "Zinc", desc: "Charcoal header · bold table",
      preview: (
        <div className="w-full h-10 rounded overflow-hidden flex flex-col">
          <div className="h-4 w-full px-1 flex items-center justify-between" style={{ backgroundColor: "#0f0f0f" }}>
            <div className="h-1 w-1/2 bg-white/30 rounded-sm" />
            <div className="h-1 w-1/4 bg-white/20 rounded-sm" />
          </div>
          <div className="h-1.5 w-full" style={{ backgroundColor: "#1a1a1a" }}>
            <div className="h-full w-1" style={{ backgroundColor: brandColor }} />
          </div>
          <div className="flex-1 space-y-px px-1 pt-0.5 bg-white">
            <div className="h-1.5 rounded-sm bg-gray-50" />
            <div className="h-1.5 rounded-sm bg-white" />
          </div>
        </div>
      ),
    },
    {
      id: "ember", label: "Ember", desc: "Full accent band · company & client merged",
      preview: (
        <div className="w-full h-10 rounded overflow-hidden flex flex-col">
          <div className="h-5 w-full px-1.5 flex items-center justify-between" style={{ backgroundColor: brandColor }}>
            <div className="flex flex-col gap-0.5">
              <div className="h-1.5 w-10 rounded-sm bg-white/80" />
              <div className="h-0.5 w-6 rounded-sm bg-white/40" />
            </div>
            <div className="flex flex-col gap-0.5 items-end">
              <div className="h-0.5 w-4 rounded-sm bg-white/30" />
              <div className="h-1 w-5 rounded-sm bg-white/60" />
            </div>
          </div>
          <div className="flex-1 space-y-px px-1 pt-0.5 bg-white">
            <div className="h-1 rounded-sm" style={{ backgroundColor: brandColor, opacity: 0.12 }} />
            <div className="h-1 rounded-sm bg-gray-50" />
            <div className="h-1 rounded-sm bg-white" />
          </div>
        </div>
      ),
    },
    {
      id: "mono", label: "Mono", desc: "Black & white · fully bordered",
      preview: (
        <div className="w-full h-10 rounded overflow-hidden flex flex-col bg-white border border-black">
          <div className="flex justify-between items-start px-1.5 pt-1 pb-0.5">
            <div className="flex flex-col gap-0.5">
              <div className="h-1.5 w-10 rounded-sm bg-black" />
              <div className="h-0.5 w-6 rounded-sm bg-gray-400" />
            </div>
            <div className="flex flex-col items-end gap-0.5">
              <div className="h-0.5 w-5 rounded-sm bg-gray-400" />
              <div className="h-1 w-8 rounded-sm bg-black" />
            </div>
          </div>
          <div className="h-px w-full bg-black" />
          <div className="flex-1">
            <div className="h-1.5 bg-black w-full" />
            <div className="flex gap-px mt-px">
              <div className="h-1 flex-1 border-b border-gray-300" />
              <div className="h-1 flex-1 border-b border-gray-300" />
            </div>
          </div>
        </div>
      ),
    },
  ];

  // ── Logo layout options ────────────────────────────────────────────────
  const logoLayouts: { id: string; label: string; desc: string; preview: ReactNode }[] = [
    {
      id: "standard", label: "Standard", desc: "Logo left of name",
      preview: (
        <div className="flex items-center gap-1.5 h-6">
          <div className="w-4 h-4 rounded-sm shrink-0" style={{ backgroundColor: previewColor }} />
          <div className="flex flex-col gap-0.5 flex-1">
            <div className="h-1.5 rounded-sm w-3/4" style={{ backgroundColor: previewColor, opacity: 0.8 }} />
            <div className="h-1 rounded-sm w-1/2 bg-muted-foreground/30" />
          </div>
        </div>
      ),
    },
    {
      id: "logo-right", label: "Logo Right", desc: "Name left · logo right",
      preview: (
        <div className="flex items-center justify-between gap-1 h-6">
          <div className="flex flex-col gap-0.5 flex-1">
            <div className="h-1.5 rounded-sm w-3/4" style={{ backgroundColor: previewColor, opacity: 0.8 }} />
            <div className="h-1 rounded-sm w-1/2 bg-muted-foreground/30" />
          </div>
          <div className="w-4 h-4 rounded-sm shrink-0" style={{ backgroundColor: previewColor }} />
        </div>
      ),
    },
    {
      id: "logo-top", label: "Logo Top", desc: "Logo above name",
      preview: (
        <div className="flex flex-col items-start gap-0.5 h-6">
          <div className="w-5 h-2.5 rounded-sm" style={{ backgroundColor: previewColor }} />
          <div className="h-1.5 rounded-sm w-2/3" style={{ backgroundColor: previewColor, opacity: 0.8 }} />
        </div>
      ),
    },
    {
      id: "centered", label: "Centered", desc: "Logo and name centered",
      preview: (
        <div className="flex flex-col items-center gap-0.5 h-6">
          <div className="w-5 h-2.5 rounded-sm" style={{ backgroundColor: previewColor }} />
          <div className="h-1.5 rounded-sm w-2/3" style={{ backgroundColor: previewColor, opacity: 0.8 }} />
        </div>
      ),
    },
    {
      id: "text-only", label: "Text Only", desc: "No logo",
      preview: (
        <div className="flex flex-col items-start gap-0.5 h-6 justify-center">
          <div className="h-2 rounded-sm w-3/4" style={{ backgroundColor: previewColor, opacity: 0.8 }} />
          <div className="h-1 rounded-sm w-1/2 bg-muted-foreground/30" />
        </div>
      ),
    },
  ];

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="p-6 max-w-3xl">

      {/* Page header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-base font-semibold">Document Settings</h1>
          <p className="text-[12px] text-muted-foreground mt-0.5">
            Controls how documents look across quotations, orders, and invoices.
          </p>
        </div>
        <Button onClick={handleSave} disabled={saving} size="sm" className="gap-1.5">
          <SaveIcon className="w-3.5 h-3.5" />
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-border mb-6">
        {(["template", "header", "table", "numbering"] as Tab[]).map((t) => (
          <button
            key={t} type="button"
            onClick={() => setActiveTab(t)}
            className={cn(
              "px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors capitalize",
              activeTab === t
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t === "template" ? "Template" : t === "header" ? "Header" : t === "table" ? "Table" : "Numbering"}
          </button>
        ))}
      </div>

      {/* ── Tab: Template ─────────────────────────────────────────────────── */}
      {activeTab === "template" && (
        <div className="space-y-6">

          {/* Template picker */}
          <Row label="Document template">
            <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4">
              {templates.map((t) => {
                const active = pdfTemplate === t.id;
                return (
                  <button
                    key={t.id} type="button"
                    onClick={() => setPdfTemplate(t.id)}
                    className={cn(
                      "text-left border rounded-xl p-2.5 transition-all",
                      active ? "border-primary bg-primary/5 ring-1 ring-primary/20" : "border-border hover:border-muted-foreground/40 hover:bg-muted/20",
                    )}
                  >
                    <div className="mb-2.5">{t.preview}</div>
                    <p className={cn("text-[11px] font-semibold", active ? "text-primary" : "text-foreground")}>{t.label}</p>
                    <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">{t.desc}</p>
                  </button>
                );
              })}
            </div>
          </Row>

          {/* Brand color */}
          <Row label="Brand colour">
            <div className="flex items-center gap-3">
              <input
                type="color" value={brandColor}
                onChange={(e) => setBrandColor(e.target.value)}
                className="w-10 h-10 rounded-lg border border-border cursor-pointer bg-transparent p-0.5"
              />
              <Input
                value={brandColor}
                onChange={(e) => setBrandColor(e.target.value)}
                placeholder="#1a56db"
                className="h-9 text-sm font-mono w-28"
                maxLength={7}
              />
              <div
                className="h-9 flex-1 rounded-lg border border-border"
                style={{ backgroundColor: brandColor }}
              />
            </div>
            <p className="text-[11px] text-muted-foreground mt-1.5">
              {pdfTemplate === "slate"
                ? "Used for lines, borders, and accent bars in Slate."
                : pdfTemplate === "mono"
                ? "Fills the table header, customer detail, and quotation detail header rows in Mono."
                : "Accent colour used across headers, column labels, and highlights."}
            </p>
          </Row>

          {/* Slate-specific colours */}
          {pdfTemplate === "slate" && (
            <div className="border border-border rounded-xl p-4 space-y-4 bg-muted/10">
              <p className="text-xs font-medium text-muted-foreground">Slate — additional colour options</p>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-[11px] text-muted-foreground mb-1.5">Text colour <span className="opacity-60">(labels, codes)</span></p>
                  <div className="flex items-center gap-2">
                    <input type="color" value={slateTextColor || brandColor}
                      onChange={(e) => setSlateTextColor(e.target.value)}
                      className="w-9 h-9 rounded-lg border border-border cursor-pointer bg-transparent p-0.5" />
                    <Input value={slateTextColor} onChange={(e) => setSlateTextColor(e.target.value)}
                      placeholder={`default: ${brandColor}`} className="h-9 text-xs font-mono flex-1" maxLength={7} />
                  </div>
                </div>
                <div>
                  <p className="text-[11px] text-muted-foreground mb-1.5">Heading colour <span className="opacity-60">(company name)</span></p>
                  <div className="flex items-center gap-2">
                    <input type="color" value={slateHeadingColor || slateTextColor || brandColor}
                      onChange={(e) => setSlateHeadingColor(e.target.value)}
                      className="w-9 h-9 rounded-lg border border-border cursor-pointer bg-transparent p-0.5" />
                    <Input value={slateHeadingColor} onChange={(e) => setSlateHeadingColor(e.target.value)}
                      placeholder="default: text colour" className="h-9 text-xs font-mono flex-1" maxLength={7} />
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Tab: Header ───────────────────────────────────────────────────── */}
      {activeTab === "header" && (
        <div className="space-y-6">

          {/* Logo arrangement */}
          <Row label="Logo & name arrangement">
            <div className="grid grid-cols-3 gap-2">
              {logoLayouts.map((opt) => {
                const active = headerLayout === opt.id;
                return (
                  <button
                    key={opt.id} type="button"
                    onClick={() => setHeaderLayout(opt.id)}
                    className={cn(
                      "text-left border rounded-xl px-3 py-2.5 transition-colors",
                      active ? "border-primary bg-primary/5" : "border-border hover:bg-muted/20",
                    )}
                  >
                    <div className="mb-2">{opt.preview}</div>
                    <p className={cn("text-[11px] font-semibold", active ? "text-primary" : "text-foreground")}>{opt.label}</p>
                    <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">{opt.desc}</p>
                  </button>
                );
              })}
            </div>
          </Row>

          {/* Company name style */}
          <div className="border border-border rounded-xl p-4 space-y-3">
            <p className="text-xs font-medium">Company name</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-[11px] text-muted-foreground mb-1.5">Size</p>
                <Pills
                  options={[
                    { id: "small",  label: "S",  sub: "10pt" },
                    { id: "medium", label: "M",  sub: "13pt" },
                    { id: "large",  label: "L",  sub: "16pt" },
                    { id: "xlarge", label: "XL", sub: "20pt" },
                  ]}
                  value={orgNameSize as any}
                  onChange={setOrgNameSize}
                />
              </div>
              <div>
                <p className="text-[11px] text-muted-foreground mb-1.5">Style</p>
                <div className="flex gap-1.5">
                  <Toggle label="Bold"     checked={orgNameBold}      onChange={() => setOrgNameBold(v => !v)} />
                  <Toggle label="ALL CAPS" checked={orgNameUppercase} onChange={() => setOrgNameUppercase(v => !v)} />
                </div>
              </div>
            </div>
            {/* Live preview */}
            <div className="rounded-lg border border-dashed border-border bg-muted/10 px-3 py-2 overflow-hidden">
              <p style={{
                fontSize: ({ small: 10, medium: 13, large: 16, xlarge: 20 } as Record<string, number>)[orgNameSize] ?? 13,
                fontWeight: orgNameBold ? 700 : 400,
                color: previewColor,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}>
                {orgNameUppercase
                  ? (data.companyName ?? data.name ?? "Company Name").toUpperCase()
                  : (data.companyName ?? data.name ?? "Company Name")}
              </p>
            </div>
          </div>

          {/* Document label style */}
          <div className="border border-border rounded-xl p-4 space-y-3">
            <p className="text-xs font-medium">Document label <span className="text-muted-foreground font-normal">(e.g. QUOTATION)</span></p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-[11px] text-muted-foreground mb-1.5">Size</p>
                <Pills
                  options={[
                    { id: "small",  label: "Small",  sub: "5.5pt" },
                    { id: "normal", label: "Normal", sub: "7pt"   },
                    { id: "large",  label: "Large",  sub: "10pt"  },
                  ]}
                  value={quotationLabelSize as any}
                  onChange={setQuotationLabelSize}
                />
              </div>
              <div>
                <p className="text-[11px] text-muted-foreground mb-1.5">Style</p>
                <div className="flex gap-1.5">
                  <Toggle label="Bold"     checked={quotationLabelBold}      onChange={() => setQuotationLabelBold(v => !v)} />
                  <Toggle label="ALL CAPS" checked={quotationLabelUppercase} onChange={() => setQuotationLabelUppercase(v => !v)} />
                </div>
              </div>
            </div>

            {/* Position picker */}
            <div>
              <p className="text-[11px] text-muted-foreground mb-1.5">Position</p>
              <div className="grid grid-cols-3 gap-2">
                {(["left", "center", "right"] as const).map((pos) => {
                  const active = quotationLabelAlign === pos;
                  const labelText = quotationLabelUppercase ? "QUOTATION" : "Quotation";
                  return (
                    <button
                      key={pos} type="button"
                      onClick={() => setQuotationLabelAlign(pos)}
                      className={cn(
                        "rounded-lg border px-2.5 pt-2 pb-1.5 transition-colors",
                        active ? "border-primary bg-primary/5" : "border-border hover:bg-muted/20",
                      )}
                    >
                      {/* mini preview */}
                      <div className="h-6 flex flex-col justify-between mb-1">
                        <div className="h-1 rounded-sm w-full bg-muted-foreground/20" />
                        <div className={cn("flex w-full", pos === "left" ? "justify-start" : pos === "center" ? "justify-center" : "justify-end")}>
                          <div
                            className="h-1 rounded-sm w-10"
                            style={{ backgroundColor: active ? previewColor : "rgb(203 213 225 / 0.5)" }}
                          />
                        </div>
                        <div className="h-0.5 rounded-sm w-full bg-muted-foreground/10" />
                      </div>
                      <p className={cn("text-[10px] font-medium capitalize text-center", active ? "text-primary" : "text-muted-foreground")}>
                        {pos}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Live preview */}
            <div className={cn(
              "rounded-lg border border-dashed border-border bg-muted/10 px-3 py-2 flex",
              quotationLabelAlign === "left"   ? "justify-start"
              : quotationLabelAlign === "center" ? "justify-center"
              :                                    "justify-end",
            )}>
              <span style={{
                fontSize: ({ small: 9, normal: 11, large: 14 } as Record<string, number>)[quotationLabelSize] ?? 11,
                fontWeight: quotationLabelBold ? 700 : 400,
                color: previewColor,
              }}>
                {quotationLabelUppercase ? "QUOTATION" : "Quotation"}
              </span>
              <span className="text-[10px] text-muted-foreground ml-2 self-end leading-none pb-px">QUO-2025-001</span>
            </div>
          </div>
        </div>
      )}

      {/* ── Tab: Table ────────────────────────────────────────────────────── */}
      {activeTab === "table" && (
        <div className="space-y-6">

          {/* Font size */}
          <Row label="Text size">
            <Pills
              options={[
                { id: "small",  label: "Small",  sub: "8pt"   },
                { id: "normal", label: "Normal", sub: "9.5pt" },
                { id: "large",  label: "Large",  sub: "11pt"  },
              ]}
              value={tableFontSize as any}
              onChange={setTableFontSize}
            />
          </Row>

          {/* Row style */}
          <Row label="Row style">
            <div className="grid grid-cols-3 gap-2">
              {([
                {
                  id: "default", label: "Alternating", desc: "Light stripe every other row",
                  preview: (
                    <div className="space-y-0.5">
                      {[0, 1, 2].map(i => (
                        <div key={i} className={`h-2 rounded-xs ${i % 2 === 1 ? "bg-blue-50" : "bg-white border border-gray-100"}`} />
                      ))}
                    </div>
                  ),
                },
                {
                  id: "simple", label: "Lines only", desc: "White rows, hairline dividers",
                  preview: (
                    <div className="border border-gray-200 rounded-xs overflow-hidden">
                      {[0, 1, 2].map(i => (
                        <div key={i} className={`h-2 bg-white ${i < 2 ? "border-b border-gray-100" : ""}`} />
                      ))}
                    </div>
                  ),
                },
                {
                  id: "rounded", label: "Rounded", desc: "Rounded outer border",
                  preview: (
                    <div className="border border-gray-300 rounded-md overflow-hidden">
                      {[0, 1, 2].map(i => (
                        <div key={i} className={`h-2 bg-white ${i < 2 ? "border-b border-gray-100" : ""}`} />
                      ))}
                    </div>
                  ),
                },
              ] as const).map((opt) => {
                const active = tableRowStyle === opt.id;
                return (
                  <button key={opt.id} type="button" onClick={() => setTableRowStyle(opt.id)}
                    className={cn("rounded-xl border p-2.5 text-left transition-colors", active ? "border-primary bg-primary/5" : "border-border hover:bg-muted/20")}>
                    <div className="mb-2">{opt.preview}</div>
                    <p className={cn("text-[11px] font-semibold", active ? "text-primary" : "text-foreground")}>{opt.label}</p>
                    <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">{opt.desc}</p>
                  </button>
                );
              })}
            </div>
          </Row>

          {/* Toggles */}
          <div className="border border-border rounded-xl divide-y divide-border overflow-hidden">
            <Switch
              label="Show product code column"
              desc="When off, the code appears as a label inside the description cell"
              checked={showCodeColumn}
              onChange={() => setShowCodeColumn(v => !v)}
            />
            <Switch
              label="Document title above table"
              desc="Places a full-width title banner at the top of the item table instead of in the header"
              checked={titlePosition === "table-banner"}
              onChange={() => setTitlePosition(v => v === "table-banner" ? "stamp" : "table-banner")}
            />
          </div>
        </div>
      )}

      {/* ── Tab: Numbering ────────────────────────────────────────────────── */}
      {activeTab === "numbering" && (
        <div className="space-y-6">

          {/* Quotation format */}
          <Row label="Quotation number format">
            <div className="space-y-1.5">
              {quotationFormats.map((f) => {
                const active = quotationNoFormat === f.id;
                return (
                  <button key={f.id} type="button" onClick={() => setQuotationNoFormat(f.id)}
                    className={cn(
                      "w-full text-left border rounded-xl px-4 py-3 transition-colors flex items-center justify-between gap-4",
                      active ? "border-primary bg-primary/5" : "border-border hover:bg-muted/20",
                    )}>
                    <p className={cn("text-[11px]", active ? "text-primary" : "text-muted-foreground")}>{f.desc}</p>
                    <span className={cn(
                      "shrink-0 font-mono text-xs px-2.5 py-1 rounded-md border",
                      active ? "bg-primary text-primary-foreground border-primary" : "bg-muted text-foreground border-border",
                    )}>{f.preview}</span>
                  </button>
                );
              })}
            </div>
          </Row>

          {/* Document numbering — SO / PO / DO / INV */}
          <Row label="Document number formats">
            <div className="space-y-2">
              {DOC_TYPES.map((dt) => {
                const s = numbering[dt];
                const previewNo = buildDocumentNo(
                  {
                    prefix: s.prefix.trim(),
                    docCode: s.docCode.trim() || DOC_TYPE_DEFAULTS[dt].docCode,
                    separator: s.separator || "-",
                    includeYear: s.includeYear ? 1 : 0,
                    paddingLength: s.paddingLength,
                    numberFormat: s.numberFormat,
                  },
                  now.getFullYear(), 1,
                );
                // Build previews for each format option
                const previewStd = buildDocumentNo(
                  { prefix: s.prefix.trim() || "SI", docCode: s.docCode.trim() || DOC_TYPE_DEFAULTS[dt].docCode,
                    separator: s.separator || "-", includeYear: s.includeYear ? 1 : 0,
                    paddingLength: s.paddingLength, numberFormat: "standard" },
                  now.getFullYear(), 1,
                );
                const previewCmp = buildDocumentNo(
                  { prefix: s.prefix.trim() || "SI", docCode: s.docCode.trim() || DOC_TYPE_DEFAULTS[dt].docCode,
                    separator: s.separator || "-", includeYear: s.includeYear ? 1 : 0,
                    paddingLength: s.paddingLength, numberFormat: "compact" },
                  now.getFullYear(), 1,
                );

                return (
                  <div key={dt} className="border border-border rounded-xl overflow-hidden">
                    {/* Header */}
                    <div className="flex items-center justify-between px-4 py-2.5 bg-muted/20 border-b border-border">
                      <span className="text-xs font-semibold">{DOC_TYPE_DEFAULTS[dt].label}</span>
                      <span className="font-mono text-xs px-2 py-0.5 rounded border bg-background border-border">{previewNo}</span>
                    </div>

                    {/* Format picker */}
                    <div className="px-3 pt-3 pb-1">
                      <p className="text-[10px] text-muted-foreground mb-1.5">Format</p>
                      <div className="grid grid-cols-2 gap-2">
                        {([
                          { id: "standard", label: "Standard", preview: previewStd, desc: "Separated parts" },
                          { id: "compact",  label: "Compact",  preview: previewCmp, desc: "Concatenated + slash" },
                        ] as const).map((f) => {
                          const active = s.numberFormat === f.id;
                          return (
                            <button
                              key={f.id} type="button"
                              onClick={() => updateNumbering(dt, { numberFormat: f.id })}
                              className={cn(
                                "text-left border rounded-lg px-3 py-2 transition-colors",
                                active ? "border-primary bg-primary/5" : "border-border hover:bg-muted/20",
                              )}
                            >
                              <p className={cn("text-[10px] font-medium mb-0.5", active ? "text-primary" : "text-foreground")}>{f.label}</p>
                              <p className="font-mono text-[11px] tabular-nums text-muted-foreground">{f.preview}</p>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Fields */}
                    <div className="p-3 grid grid-cols-2 gap-2">
                      <div>
                        <p className="text-[10px] text-muted-foreground mb-1">Doc code</p>
                        <Input value={s.docCode} onChange={(e) => updateNumbering(dt, { docCode: e.target.value.toUpperCase() })}
                          placeholder={DOC_TYPE_DEFAULTS[dt].docCode} className="h-7 text-xs font-mono" maxLength={6} />
                      </div>
                      <div>
                        <p className="text-[10px] text-muted-foreground mb-1">Company code</p>
                        <Input value={s.prefix} onChange={(e) => updateNumbering(dt, { prefix: e.target.value })}
                          placeholder="e.g. SI" className="h-7 text-xs font-mono" maxLength={10} />
                      </div>
                      {s.numberFormat === "standard" && (
                        <div>
                          <p className="text-[10px] text-muted-foreground mb-1">Separator</p>
                          <select value={s.separator} onChange={(e) => updateNumbering(dt, { separator: e.target.value })}
                            className="w-full h-7 rounded-md border border-border bg-background px-2 text-xs font-mono">
                            <option value="-">- hyphen</option>
                            <option value="/">/ slash</option>
                            <option value=".">. dot</option>
                            <option value="">none</option>
                          </select>
                        </div>
                      )}
                      <div>
                        <p className="text-[10px] text-muted-foreground mb-1">Counter digits</p>
                        <select value={s.paddingLength} onChange={(e) => updateNumbering(dt, { paddingLength: parseInt(e.target.value) })}
                          className="w-full h-7 rounded-md border border-border bg-background px-2 text-xs">
                          <option value={3}>3 — 001</option>
                          <option value={4}>4 — 0001</option>
                          <option value={5}>5 — 00001</option>
                          <option value={6}>6 — 000001</option>
                        </select>
                      </div>
                    </div>
                    <div className="px-3 pb-3">
                      <Switch label="Include year" checked={s.includeYear} onChange={() => updateNumbering(dt, { includeYear: !s.includeYear })} />
                    </div>
                  </div>
                );
              })}
            </div>
          </Row>
        </div>
      )}

      {/* Bottom save */}
      <div className="flex justify-end pt-8 pb-4">
        <Button onClick={handleSave} disabled={saving} className="gap-1.5">
          <SaveIcon className="w-3.5 h-3.5" />
          {saving ? "Saving…" : "Save settings"}
        </Button>
      </div>
    </div>
  );
}
