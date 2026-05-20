"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { upsertOrganizationProfile, FullOrganizationProfile } from "@/server/organization-profile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SaveIcon, PaletteIcon, LayoutTemplateIcon, TableIcon, TypeIcon, HashIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  data: FullOrganizationProfile;
}

function SectionHeader({ icon: Icon, title }: { icon: any; title: string }) {
  return (
    <div className="px-4 py-3 border-b border-border bg-muted/20 flex items-center gap-2">
      <Icon className="w-3.5 h-3.5 text-muted-foreground" />
      <div className="text-xs font-medium">{title}</div>
    </div>
  );
}

export function DocumentSettingsClient({ data }: Props) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  // Branding
  const [brandColor, setBrandColor] = useState(data.brandColor ?? "#1a56db");
  const [slateTextColor, setSlateTextColor] = useState(data.slateTextColor ?? "");
  const [slateHeadingColor, setSlateHeadingColor] = useState(data.slateHeadingColor ?? "");

  // Template — single picker controlling both HTML preview and PDF download
  const [pdfTemplate, setPdfTemplate] = useState(data.pdfTemplate ?? "affirma");

  // Header
  const [headerLayout, setHeaderLayout] = useState(data.headerLayout ?? "standard");
  const [orgNameSize, setOrgNameSize] = useState(data.orgNameSize ?? "medium");
  const [orgNameBold, setOrgNameBold] = useState(!!(data.orgNameBold ?? 1));
  const [orgNameUppercase, setOrgNameUppercase] = useState(!!(data.orgNameUppercase ?? 0));
  const [orgInfoSide, setOrgInfoSide] = useState(data.orgInfoSide ?? "left");

  // Document label
  const [quotationLabelSize, setQuotationLabelSize] = useState(data.quotationLabelSize ?? "normal");
  const [quotationLabelBold, setQuotationLabelBold] = useState(!!(data.quotationLabelBold ?? 1));
  const [quotationLabelUppercase, setQuotationLabelUppercase] = useState(!!(data.quotationLabelUppercase ?? 1));

  // Table
  const [tableRowStyle, setTableRowStyle] = useState(data.tableRowStyle ?? "default");
  const [showCodeColumn, setShowCodeColumn] = useState(!!(data.showCodeColumn ?? 1));
  const [tableFontSize, setTableFontSize] = useState(data.tableFontSize ?? "normal");
  const [titlePosition, setTitlePosition] = useState(data.titlePosition ?? "stamp");

  // Number format
  const [quotationNoFormat, setQuotationNoFormat] = useState(data.quotationNoFormat ?? "A");

  // Attention block (customer section)
  const [attentionNameSize, setAttentionNameSize] = useState(data.attentionNameSize ?? "medium");
  const [attentionNameBold, setAttentionNameBold] = useState(!!(data.attentionNameBold ?? 1));

  // Quotation detail block (right-side info)
  const [detailFontSize, setDetailFontSize] = useState(data.detailFontSize ?? "normal");
  const [detailFontBold, setDetailFontBold] = useState(!!(data.detailFontBold ?? 0));
  const [detailAlignment, setDetailAlignment] = useState(data.detailAlignment ?? "right");

  const handleSave = async () => {
    setSaving(true);
    try {
      // templateStyle kept in sync for any legacy readers
      const templateStyle =
        pdfTemplate === "nexus" || pdfTemplate === "zinc" ? "modern"
        : pdfTemplate === "slate" ? "bold"
        : "corporate";

      await upsertOrganizationProfile({
        brandColor,
        slateTextColor:    slateTextColor    || null,
        slateHeadingColor: slateHeadingColor || null,
        pdfTemplate,
        templateStyle,
        headerLayout,
        orgNameSize,
        orgNameBold: orgNameBold ? 1 : 0,
        orgNameUppercase: orgNameUppercase ? 1 : 0,
        orgInfoSide,
        quotationLabelSize,
        quotationLabelBold: quotationLabelBold ? 1 : 0,
        quotationLabelUppercase: quotationLabelUppercase ? 1 : 0,
        tableRowStyle,
        showCodeColumn: showCodeColumn ? 1 : 0,
        tableFontSize,
        titlePosition,
        quotationNoFormat,
        attentionNameSize,
        attentionNameBold: attentionNameBold ? 1 : 0,
        detailFontSize,
        detailFontBold: detailFontBold ? 1 : 0,
        detailAlignment,
      });
      toast.success("Document settings saved");
      router.refresh();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  // ── Quotation number preview helpers ──────────────────────────────────────
  const now = new Date();
  const year = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const yy = String(year).slice(-2);
  const slug = (data.slug ?? "ORG").slice(0, 3).toUpperCase();
  const cleanedName = (data.companyName ?? data.name ?? "ORG")
    .replace(/\s*\(M\)\s*/gi, " ")
    .replace(/\bsdn\.?\s*bhd\.?\b/gi, "")
    .replace(/\bbhd\.?\b/gi, "")
    .replace(/\bsdn\.?\b/gi, "")
    .trim();
  const initials = (data.companyName ?? data.name ?? "ORG")
    .split(/\s+/).filter(Boolean).map((w: string) => w[0]).join("").toUpperCase();

  const numberFormats = [
    { id: "A", label: "Format A", template: "{slug}-QT-{yyyy}-{XXXX}",   preview: `${slug}-QT-${year}-0001`,                desc: "Slug prefix · year · 4-digit counter" },
    { id: "B", label: "Format B", template: "Q{name}-{mmyy}-{XXXXX}",    preview: `Q${cleanedName.slice(0, 3).toUpperCase()}-${mm}${yy}-00001`, desc: "Q + name prefix · month-year · 5-digit counter" },
    { id: "C", label: "Format C", template: "QT-{initials}-{yyyy}-{XXXXXX}", preview: `QT-${initials}-${year}-000001`,         desc: "QT + initials · year · 6-digit counter" },
  ];

  return (
    <div className="max-w-2xl mx-auto py-8 px-4 space-y-6">
      {/* Save bar */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-base font-semibold">Document Settings</h1>
          <p className="text-[12px] text-muted-foreground mt-0.5">
            Controls how documents look across quotations, delivery orders, and invoices.
          </p>
        </div>
        <Button onClick={handleSave} disabled={saving} size="sm" className="gap-1.5">
          <SaveIcon className="w-3.5 h-3.5" />
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>

      {/* ── Brand & Template ────────────────────────────────────────────────── */}
      <div className="bg-background border border-border rounded-xl overflow-hidden">
        <SectionHeader icon={PaletteIcon} title="Brand & Template" />
        <div className="p-4 space-y-5">

          {/* Brand color */}
          <div>
            <label className="block text-[11px] font-medium text-muted-foreground mb-1.5">
              {pdfTemplate === "slate" ? "Line & box colour" : "Brand colour"}
            </label>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={brandColor}
                onChange={(e) => setBrandColor(e.target.value)}
                className="w-10 h-10 rounded-lg border border-border cursor-pointer bg-transparent p-0.5"
              />
              <Input
                value={brandColor}
                onChange={(e) => setBrandColor(e.target.value)}
                placeholder="#1a56db"
                className="h-9 text-sm font-mono w-32"
                maxLength={7}
              />
              <div
                className="h-9 flex-1 rounded-lg border border-border transition-colors"
                style={{ backgroundColor: brandColor }}
              />
            </div>
            <p className="text-[11px] text-muted-foreground mt-1.5">
              {pdfTemplate === "slate"
                ? "Slate: used for lines, borders, badges, and accent bars."
                : "Used as the accent colour across all document templates."}
            </p>
          </div>

          {/* Slate-specific colours */}
          {pdfTemplate === "slate" && (
            <div className="space-y-4 pl-3 border-l-2 border-border">
              {/* Text colour */}
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1.5">
                  Text colour <span className="font-normal text-muted-foreground/60">(labels, codes, table headers)</span>
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="color"
                    value={slateTextColor || brandColor}
                    onChange={(e) => setSlateTextColor(e.target.value)}
                    className="w-10 h-10 rounded-lg border border-border cursor-pointer bg-transparent p-0.5"
                  />
                  <Input
                    value={slateTextColor}
                    onChange={(e) => setSlateTextColor(e.target.value)}
                    placeholder={`defaults to ${brandColor}`}
                    className="h-9 text-sm font-mono w-40"
                    maxLength={7}
                  />
                  {slateTextColor && (
                    <div className="h-9 flex-1 rounded-lg border border-border" style={{ backgroundColor: slateTextColor }} />
                  )}
                </div>
              </div>
              {/* Heading colour */}
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1.5">
                  Heading colour <span className="font-normal text-muted-foreground/60">(company name + QUOTATION label)</span>
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="color"
                    value={slateHeadingColor || slateTextColor || brandColor}
                    onChange={(e) => setSlateHeadingColor(e.target.value)}
                    className="w-10 h-10 rounded-lg border border-border cursor-pointer bg-transparent p-0.5"
                  />
                  <Input
                    value={slateHeadingColor}
                    onChange={(e) => setSlateHeadingColor(e.target.value)}
                    placeholder={`defaults to text colour`}
                    className="h-9 text-sm font-mono w-40"
                    maxLength={7}
                  />
                  {slateHeadingColor && (
                    <div className="h-9 flex-1 rounded-lg border border-border" style={{ backgroundColor: slateHeadingColor }} />
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Template — unified selector (HTML preview + PDF) */}
          <div>
            <label className="block text-[11px] font-medium text-muted-foreground mb-0.5">Document template</label>
            <p className="text-[11px] text-muted-foreground mb-2">Controls both the print preview and the downloaded PDF.</p>
            <div className="grid grid-cols-3 gap-2">
              {([
                {
                  id: "affirma",
                  label: "Affirma",
                  desc: "Stamp header · alternating rows",
                  preview: (
                    <div className="w-full h-10 rounded overflow-hidden flex flex-col" style={{ backgroundColor: "white", border: `1.5px solid ${brandColor}` }}>
                      <div className="flex gap-1 p-1">
                        <div className="flex flex-col gap-0.5 flex-1">
                          <div className="h-1 rounded-sm w-3/4" style={{ backgroundColor: brandColor, opacity: 0.7 }} />
                          <div className="h-0.5 rounded-sm w-1/2 bg-gray-200" />
                        </div>
                        <div className="w-5 border rounded-sm shrink-0" style={{ borderColor: brandColor }} />
                      </div>
                      <div className="flex-1 space-y-px px-1 pb-0.5">
                        <div className="h-1.5 rounded-sm bg-blue-50" />
                        <div className="h-1.5 rounded-sm bg-white" />
                        <div className="h-1.5 rounded-sm bg-blue-50" />
                      </div>
                    </div>
                  ),
                },
                {
                  id: "nexus",
                  label: "Nexus",
                  desc: "Full-bleed header · clean rows",
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
                  id: "slate",
                  label: "Slate",
                  desc: "Typographic header · badge rows",
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
                            <div className="h-0.5 flex-1 bg-gray-200" style={{ borderTop: "1px dashed #d1d5db" }} />
                          </div>
                        ))}
                      </div>
                    </div>
                  ),
                },
                {
                  id: "aura",
                  label: "Aura",
                  desc: "Editorial · floating header",
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
                  id: "zinc",
                  label: "Zinc",
                  desc: "Charcoal header · bold table",
                  preview: (
                    <div className="w-full h-10 rounded overflow-hidden flex flex-col">
                      <div className="h-4 w-full px-1 flex items-center justify-between" style={{ backgroundColor: "#0f0f0f" }}>
                        <div className="h-1 w-1/2 bg-white/30 rounded-sm" />
                        <div className="h-1 w-1/4 bg-white/20 rounded-sm" />
                      </div>
                      <div className="h-1.5 w-full px-0" style={{ backgroundColor: "#1a1a1a" }}>
                        <div className="h-full w-1" style={{ backgroundColor: brandColor }} />
                      </div>
                      <div className="flex-1 space-y-px px-1 pt-0.5 bg-white">
                        <div className="h-1.5 rounded-sm bg-gray-50" />
                        <div className="h-1.5 rounded-sm bg-white" />
                      </div>
                    </div>
                  ),
                },
              ] as { id: string; label: string; desc: string; preview: ReactNode }[]).map((t) => {
                const active = pdfTemplate === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setPdfTemplate(t.id)}
                    className={cn(
                      "text-left border rounded-lg p-2.5 transition-colors",
                      active ? "border-primary bg-primary/5" : "border-border hover:bg-muted/30",
                    )}
                  >
                    <div className="mb-2">{t.preview}</div>
                    <p className={cn("text-[11px] font-semibold", active ? "text-primary" : "text-foreground")}>{t.label}</p>
                    <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">{t.desc}</p>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* ── Header layout ─────────────────────────────────────────────────── */}
      <div className="bg-background border border-border rounded-xl overflow-hidden">
        <SectionHeader icon={LayoutTemplateIcon} title="Header layout" />
        <div className="p-4 space-y-4">

          {/* Layout */}
          <div>
            <label className="block text-[11px] font-medium text-muted-foreground mb-1.5">Logo & name arrangement</label>
            <div className="grid grid-cols-2 gap-2">
              {([
                { id: "standard",  label: "Standard",  desc: "Logo left of company name" },
                { id: "logo-top",  label: "Logo Top",  desc: "Logo above company name" },
                { id: "centered",  label: "Centered",  desc: "Logo and name centered" },
                { id: "text-only", label: "Text Only", desc: "No logo — name and address only" },
              ] as const).map((opt) => {
                const active = headerLayout === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setHeaderLayout(opt.id)}
                    className={cn("text-left border rounded-lg px-3 py-2.5 transition-colors", active ? "border-primary bg-primary/5" : "border-border hover:bg-muted/30")}
                  >
                    <div className="flex gap-1 mb-1.5 items-start h-6">
                      {opt.id === "standard" && (
                        <>
                          <div className="w-4 h-4 rounded-sm shrink-0 mt-0.5" style={{ backgroundColor: brandColor }} />
                          <div className="flex flex-col gap-0.5 flex-1">
                            <div className="h-1.5 rounded-sm w-3/4" style={{ backgroundColor: brandColor, opacity: 0.8 }} />
                            <div className="h-1 rounded-sm w-1/2 bg-muted-foreground/30" />
                          </div>
                        </>
                      )}
                      {opt.id === "logo-top" && (
                        <div className="flex flex-col items-start gap-0.5 flex-1">
                          <div className="w-5 h-3 rounded-sm" style={{ backgroundColor: brandColor }} />
                          <div className="h-1.5 rounded-sm w-3/4 mt-0.5" style={{ backgroundColor: brandColor, opacity: 0.8 }} />
                          <div className="h-1 rounded-sm w-1/2 bg-muted-foreground/30" />
                        </div>
                      )}
                      {opt.id === "centered" && (
                        <div className="flex flex-col items-center gap-0.5 flex-1">
                          <div className="w-5 h-3 rounded-sm" style={{ backgroundColor: brandColor }} />
                          <div className="h-1.5 rounded-sm w-3/4 mt-0.5" style={{ backgroundColor: brandColor, opacity: 0.8 }} />
                          <div className="h-1 rounded-sm w-1/2 bg-muted-foreground/30" />
                        </div>
                      )}
                      {opt.id === "text-only" && (
                        <div className="flex flex-col items-start gap-0.5 flex-1">
                          <div className="h-2 rounded-sm w-3/4" style={{ backgroundColor: brandColor, opacity: 0.8 }} />
                          <div className="h-1 rounded-sm w-1/2 bg-muted-foreground/30" />
                          <div className="h-1 rounded-sm w-2/5 bg-muted-foreground/20" />
                        </div>
                      )}
                    </div>
                    <div className={cn("text-xs font-semibold mb-0.5", active ? "text-primary" : "text-foreground")}>{opt.label}</div>
                    <p className="text-[10px] text-muted-foreground leading-tight">{opt.desc}</p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Info panel side */}
          <div>
            <label className="block text-[11px] font-medium text-muted-foreground mb-1.5">Info panel side</label>
            <div className="grid grid-cols-2 gap-2">
              {([
                { id: "left",  label: "Left",  desc: "Org info left · Document ID right" },
                { id: "right", label: "Right", desc: "Document ID left · Org info right" },
              ] as const).map((opt) => {
                const active = orgInfoSide === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setOrgInfoSide(opt.id)}
                    className={cn("text-left border rounded-lg px-3 py-2.5 transition-colors", active ? "border-primary bg-primary/5" : "border-border hover:bg-muted/30")}
                  >
                    <div className="flex gap-1 mb-1.5 items-center h-5">
                      {opt.id === "left" ? (
                        <>
                          <div className="flex flex-col gap-0.5 flex-1">
                            <div className="h-1.5 rounded-sm w-3/4" style={{ backgroundColor: brandColor, opacity: 0.8 }} />
                            <div className="h-1 rounded-sm w-1/2 bg-muted-foreground/30" />
                          </div>
                          <div className="w-5 h-4 rounded border shrink-0" style={{ borderColor: brandColor, opacity: 0.6 }} />
                        </>
                      ) : (
                        <>
                          <div className="w-5 h-4 rounded border shrink-0" style={{ borderColor: brandColor, opacity: 0.6 }} />
                          <div className="flex flex-col gap-0.5 flex-1">
                            <div className="h-1.5 rounded-sm w-3/4" style={{ backgroundColor: brandColor, opacity: 0.8 }} />
                            <div className="h-1 rounded-sm w-1/2 bg-muted-foreground/30" />
                          </div>
                        </>
                      )}
                    </div>
                    <div className={cn("text-xs font-semibold mb-0.5", active ? "text-primary" : "text-foreground")}>{opt.label}</div>
                    <p className="text-[10px] text-muted-foreground leading-tight">{opt.desc}</p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Organisation name style */}
          <div className="space-y-2.5">
            <label className="block text-[11px] font-medium text-muted-foreground">Organisation name style</label>
            <div>
              <p className="text-[10px] text-muted-foreground mb-1">Font size</p>
              <div className="grid grid-cols-4 gap-1.5">
                {([
                  { id: "small",  label: "Small",   pt: "10pt" },
                  { id: "medium", label: "Medium",  pt: "13pt" },
                  { id: "large",  label: "Large",   pt: "16pt" },
                  { id: "xlarge", label: "X-Large", pt: "20pt" },
                ] as const).map((opt) => {
                  const active = orgNameSize === opt.id;
                  return (
                    <button key={opt.id} type="button" onClick={() => setOrgNameSize(opt.id)}
                      className={cn("border rounded-lg px-2 py-2 text-center transition-colors", active ? "border-primary bg-primary/5" : "border-border hover:bg-muted/30")}>
                      <div className={cn("text-xs font-semibold", active ? "text-primary" : "text-foreground")}>{opt.label}</div>
                      <div className="text-[10px] text-muted-foreground">{opt.pt}</div>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => setOrgNameBold(v => !v)}
                className={cn("flex-1 border rounded-lg py-2 text-xs font-bold transition-colors", orgNameBold ? "border-primary bg-primary/5 text-primary" : "border-border text-muted-foreground hover:bg-muted/30")}>
                Bold
              </button>
              <button type="button" onClick={() => setOrgNameUppercase(v => !v)}
                className={cn("flex-1 border rounded-lg py-2 text-xs font-medium transition-colors", orgNameUppercase ? "border-primary bg-primary/5 text-primary" : "border-border text-muted-foreground hover:bg-muted/30")}>
                ALL CAPS
              </button>
            </div>
            <div className="p-2.5 bg-muted/20 rounded-lg border border-dashed border-border">
              <p className="truncate" style={{
                fontSize: ({ small: 10, medium: 13, large: 16, xlarge: 20 } as Record<string, number>)[orgNameSize] ?? 13,
                fontWeight: orgNameBold ? 700 : 400,
                color: brandColor,
              }}>
                {orgNameUppercase
                  ? (data.companyName ?? data.name ?? "Company Name").toUpperCase()
                  : (data.companyName ?? data.name ?? "Company Name")}
              </p>
            </div>
          </div>

          {/* Document label style */}
          <div className="space-y-2.5">
            <label className="block text-[11px] font-medium text-muted-foreground">Document label style</label>
            <div>
              <p className="text-[10px] text-muted-foreground mb-1">Font size</p>
              <div className="grid grid-cols-3 gap-1.5">
                {([
                  { id: "small",  label: "Small",  pt: "5.5pt" },
                  { id: "normal", label: "Normal", pt: "7pt" },
                  { id: "large",  label: "Large",  pt: "10pt" },
                ] as const).map((opt) => {
                  const active = quotationLabelSize === opt.id;
                  return (
                    <button key={opt.id} type="button" onClick={() => setQuotationLabelSize(opt.id)}
                      className={cn("border rounded-lg px-2 py-2 text-center transition-colors", active ? "border-primary bg-primary/5" : "border-border hover:bg-muted/30")}>
                      <div className={cn("text-xs font-semibold", active ? "text-primary" : "text-foreground")}>{opt.label}</div>
                      <div className="text-[10px] text-muted-foreground">{opt.pt}</div>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => setQuotationLabelBold(v => !v)}
                className={cn("flex-1 border rounded-lg py-2 text-xs font-bold transition-colors", quotationLabelBold ? "border-primary bg-primary/5 text-primary" : "border-border text-muted-foreground hover:bg-muted/30")}>
                Bold
              </button>
              <button type="button" onClick={() => setQuotationLabelUppercase(v => !v)}
                className={cn("flex-1 border rounded-lg py-2 text-xs font-medium transition-colors", quotationLabelUppercase ? "border-primary bg-primary/5 text-primary" : "border-border text-muted-foreground hover:bg-muted/30")}>
                ALL CAPS
              </button>
            </div>
            <div className="p-2 bg-muted/20 rounded-lg border border-dashed border-border flex items-center gap-1.5">
              <span style={{
                fontSize: ({ small: 9, normal: 11, large: 14 } as Record<string, number>)[quotationLabelSize] ?? 11,
                fontWeight: quotationLabelBold ? 700 : 400,
                color: brandColor,
              }}>
                {quotationLabelUppercase ? "QUOTATION" : "Quotation"}
              </span>
              <span className="text-[10px] text-muted-foreground">· QUO-2025-001</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Table settings ─────────────────────────────────────────────────── */}
      <div className="bg-background border border-border rounded-xl overflow-hidden">
        <SectionHeader icon={TableIcon} title="Table settings" />
        <div className="p-4 space-y-4">

          {/* Table row style */}
          <div>
            <label className="block text-[11px] font-medium text-muted-foreground mb-1.5">Row style</label>
            <div className="grid grid-cols-3 gap-2">
              {([
                {
                  id: "default",
                  label: "Default",
                  desc: "Alternating light rows",
                  preview: (
                    <div className="space-y-0.5">
                      {[0, 1, 2].map(i => (
                        <div key={i} className={`h-2 rounded-[1px] ${i % 2 === 1 ? "bg-blue-50" : "bg-white border border-gray-100"}`} />
                      ))}
                    </div>
                  ),
                },
                {
                  id: "simple",
                  label: "Simple",
                  desc: "White rows, hairlines only",
                  preview: (
                    <div className="border border-gray-200 rounded-[1px] overflow-hidden">
                      {[0, 1, 2].map(i => (
                        <div key={i} className={`h-2 bg-white ${i < 2 ? "border-b border-gray-100" : ""}`} />
                      ))}
                    </div>
                  ),
                },
                {
                  id: "rounded",
                  label: "Rounded",
                  desc: "Rounded outer border",
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
                    className={cn("rounded-lg border p-2.5 text-left transition-colors", active ? "border-primary bg-primary/5" : "border-border hover:bg-muted/30")}>
                    <div className="mb-1.5">{opt.preview}</div>
                    <p className={cn("text-[11px] font-semibold", active ? "text-primary" : "text-foreground")}>{opt.label}</p>
                    <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">{opt.desc}</p>
                  </button>
                );
              })}
            </div>
            <div className="mt-3 flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
              <div>
                <p className="text-[11px] font-medium text-foreground">Show product code column</p>
                <p className="text-[10px] text-muted-foreground">When off, code appears as a label inside the description column</p>
              </div>
              <button type="button" role="switch" aria-checked={showCodeColumn}
                onClick={() => setShowCodeColumn(v => !v)}
                className={cn("relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors", showCodeColumn ? "bg-primary" : "bg-muted")}>
                <span className={cn("pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow ring-0 transition-transform", showCodeColumn ? "translate-x-4" : "translate-x-0")} />
              </button>
            </div>
          </div>

          {/* Table font size */}
          <div>
            <label className="block text-[11px] font-medium text-muted-foreground mb-1.5">Table text size</label>
            <div className="grid grid-cols-3 gap-2">
              {([
                { id: "small",  label: "Small",  desc: "8 pt" },
                { id: "normal", label: "Normal", desc: "9.5 pt" },
                { id: "large",  label: "Large",  desc: "11 pt" },
              ] as const).map((opt) => {
                const active = tableFontSize === opt.id;
                return (
                  <button key={opt.id} type="button" onClick={() => setTableFontSize(opt.id)}
                    className={cn("text-left border rounded-lg px-3 py-2 transition-colors", active ? "border-primary bg-primary/5" : "border-border hover:bg-muted/30")}>
                    <div className={cn("text-xs font-semibold", active ? "text-primary" : "text-foreground")}>{opt.label}</div>
                    <div className="text-[10px] text-muted-foreground">{opt.desc}</div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Title position */}
          <div>
            <label className="block text-[11px] font-medium text-muted-foreground mb-1.5">Document title position</label>
            <div className="grid grid-cols-2 gap-2">
              {([
                { id: "stamp",        label: "In header",   desc: "Title shown inside the stamp / header area" },
                { id: "table-banner", label: "Above table", desc: "Full-width banner spanning the top of the item table" },
              ] as const).map((opt) => {
                const active = titlePosition === opt.id;
                return (
                  <button key={opt.id} type="button" onClick={() => setTitlePosition(opt.id)}
                    className={cn("text-left border rounded-lg px-3 py-2.5 transition-colors", active ? "border-primary bg-primary/5" : "border-border hover:bg-muted/30")}>
                    <div className={cn("text-xs font-semibold mb-0.5", active ? "text-primary" : "text-foreground")}>{opt.label}</div>
                    <p className="text-[10px] text-muted-foreground leading-tight">{opt.desc}</p>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* ── Info section styles ─────────────────────────────────────────────── */}
      <div className="bg-background border border-border rounded-xl overflow-hidden">
        <SectionHeader icon={TypeIcon} title="Info section style" />
        <div className="p-4 space-y-5">
          <p className="text-[11px] text-muted-foreground -mt-1">Controls the &quot;Attention To&quot; and quotation detail block that appears below the company header.</p>

          {/* Attention block */}
          <div>
            <label className="block text-[11px] font-semibold text-foreground mb-2">Attention block (customer name)</label>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] text-muted-foreground mb-1.5">Name size</label>
                <div className="grid grid-cols-4 gap-1.5">
                  {(["small","medium","large","xlarge"] as const).map((s) => (
                    <button key={s} type="button" onClick={() => setAttentionNameSize(s)}
                      className={cn("border rounded px-2 py-1.5 text-[10px] transition-colors capitalize", attentionNameSize === s ? "border-primary bg-primary/5 text-primary font-semibold" : "border-border hover:bg-muted/30")}>
                      {s === "xlarge" ? "XL" : s.charAt(0).toUpperCase() + s.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-[10px] text-muted-foreground mb-1.5">Style</label>
                <button type="button" onClick={() => setAttentionNameBold(!attentionNameBold)}
                  className={cn("border rounded px-3 py-1.5 text-[10px] font-semibold transition-colors", attentionNameBold ? "border-primary bg-primary/5 text-primary" : "border-border hover:bg-muted/30")}>
                  Bold
                </button>
              </div>
            </div>
          </div>

          {/* Detail block */}
          <div>
            <label className="block text-[11px] font-semibold text-foreground mb-2">Quotation detail block (right side)</label>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-[10px] text-muted-foreground mb-1.5">Font size</label>
                <div className="grid grid-cols-3 gap-1.5">
                  {(["small","normal","large"] as const).map((s) => (
                    <button key={s} type="button" onClick={() => setDetailFontSize(s)}
                      className={cn("border rounded px-2 py-1.5 text-[10px] transition-colors capitalize", detailFontSize === s ? "border-primary bg-primary/5 text-primary font-semibold" : "border-border hover:bg-muted/30")}>
                      {s.charAt(0).toUpperCase() + s.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-[10px] text-muted-foreground mb-1.5">Style</label>
                <button type="button" onClick={() => setDetailFontBold(!detailFontBold)}
                  className={cn("border rounded px-3 py-1.5 text-[10px] font-semibold transition-colors", detailFontBold ? "border-primary bg-primary/5 text-primary" : "border-border hover:bg-muted/30")}>
                  Bold
                </button>
              </div>
              <div>
                <label className="block text-[10px] text-muted-foreground mb-1.5">Alignment</label>
                <div className="grid grid-cols-2 gap-1.5">
                  {(["left","right"] as const).map((a) => (
                    <button key={a} type="button" onClick={() => setDetailAlignment(a)}
                      className={cn("border rounded px-2 py-1.5 text-[10px] transition-colors capitalize", detailAlignment === a ? "border-primary bg-primary/5 text-primary font-semibold" : "border-border hover:bg-muted/30")}>
                      {a.charAt(0).toUpperCase() + a.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Quotation number format ─────────────────────────────────────────── */}
      <div className="bg-background border border-border rounded-xl overflow-hidden">
        <SectionHeader icon={HashIcon} title="Quotation number format" />
        <div className="p-4 space-y-2">
          <p className="text-[11px] text-muted-foreground mb-3">Choose how quotation numbers are generated for this organisation.</p>
          {numberFormats.map((f) => {
            const active = quotationNoFormat === f.id;
            return (
              <button key={f.id} type="button" onClick={() => setQuotationNoFormat(f.id)}
                className={cn("w-full text-left border rounded-lg px-4 py-3 transition-colors", active ? "border-primary bg-primary/5" : "border-border hover:bg-muted/30")}>
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-xs font-semibold">{f.label}</span>
                      <span className="text-[10px] text-muted-foreground font-mono">{f.template}</span>
                    </div>
                    <div className="text-[11px] text-muted-foreground">{f.desc}</div>
                  </div>
                  <div className={cn("shrink-0 font-mono text-xs px-2.5 py-1 rounded-md border", active ? "bg-primary text-primary-foreground border-primary" : "bg-muted text-foreground border-border")}>
                    {f.preview}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Bottom save */}
      <div className="flex justify-end pt-2 pb-8">
        <Button onClick={handleSave} disabled={saving} className="gap-1.5">
          <SaveIcon className="w-3.5 h-3.5" />
          {saving ? "Saving…" : "Save settings"}
        </Button>
      </div>
    </div>
  );
}
