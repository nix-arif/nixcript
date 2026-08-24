"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { upsertProfile, uploadBankBook } from "@/server/profile";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
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
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  UserIcon,
  MapPinIcon,
  BuildingIcon,
  HeartPulseIcon,
  GraduationCapIcon,
  CreditCardIcon,
  ShieldCheckIcon,
  PlusIcon,
  XIcon,
  UploadIcon,
  CheckCircleIcon,
  ChevronRightIcon,
  ChevronLeftIcon,
  CheckIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

const PDPA_TEXT = `NOTIS PERLINDUNGAN DATA PERIBADI
PERSONAL DATA PROTECTION NOTICE

Pursuant to the Personal Data Protection Act 2010 (PDPA 2010), this notice informs you of the following:

PURPOSE OF COLLECTION
Your personal data is collected solely for employment administration, payroll processing, emergency contact purposes, and statutory compliance.

DATA SECURITY
All data is stored securely and access is restricted to authorised personnel only. Your data will not be sold or disclosed to third parties except where required by Malaysian law.

YOUR RIGHTS
You have the right to access, correct, or withdraw consent for your personal data at any time by contacting your HR administrator.

RETENTION
Data is retained for the duration of employment and up to 7 years thereafter as required by Malaysian employment law.

By submitting this form, you expressly consent to the collection, processing, and storage of your personal data as described above in accordance with PDPA 2010.`;

const schema = z.object({
  fullname: z.string().optional(),
  icNumber: z.string().optional(),
  dateOfBirth: z.string().optional(),
  gender: z.string().optional(),
  nationality: z.string().optional(),
  race: z.string().optional(),
  maritalStatus: z.string().optional(),
  mailingAddress: z.string().optional(),
  permanentAddress: z.string().optional(),
  personalEmail: z.string().email("Invalid email").optional().or(z.literal("")),
  emergencyName1: z.string().optional(),
  emergencyRelationship1: z.string().optional(),
  emergencyPhone1: z.string().optional(),
  emergencyAddress1: z.string().optional(),
  emergencyName2: z.string().optional(),
  emergencyRelationship2: z.string().optional(),
  emergencyPhone2: z.string().optional(),
  emergencyAddress2: z.string().optional(),
  // Statutory numbers
  taxNo: z.string().optional(),
  epfNo: z.string().optional(),
  socsoNo: z.string().optional(),
  // Bank details
  bankName: z.string().optional(),
  bankAccountNo: z.string().optional(),
  bankAccountHolder: z.string().optional(),
  // Employment
  jobTitle: z.string().optional(),
  department: z.string().optional(),
  employmentType: z.string().optional(),
  employmentStatus: z.string().optional(),
  // Education
  educationLevel: z.string().optional(),
  fieldOfStudy: z.string().optional(),
  // PDPA
  pdpaConsent: z.boolean().refine((v) => v === true, {
    message: "You must agree to the PDPA 2010 before saving",
  }),
});

type FormValues = z.infer<typeof schema>;
type SectionId =
  | "personal"
  | "contact"
  | "emergency"
  | "employment"
  | "education"
  | "banking";

const SECTIONS: {
  id: SectionId;
  label: string;
  icon: React.ElementType;
  description: string;
}[] = [
  {
    id: "personal",
    label: "Personal",
    icon: UserIcon,
    description: "Identity & demographics",
  },
  {
    id: "contact",
    label: "Contact",
    icon: MapPinIcon,
    description: "Address, phone & email",
  },
  {
    id: "emergency",
    label: "Emergency",
    icon: HeartPulseIcon,
    description: "Emergency contacts",
  },
  {
    id: "employment",
    label: "Employment",
    icon: BuildingIcon,
    description: "Job details",
  },
  {
    id: "education",
    label: "Education",
    icon: GraduationCapIcon,
    description: "Qualifications",
  },
  {
    id: "banking",
    label: "Banking",
    icon: CreditCardIcon,
    description: "Payment details",
  },
];

interface Props {
  user: { id: string; name: string; email: string; image?: string | null };
  initialProfile: any;
}

const EMPLOYMENT_STATUS_LABELS: Record<string, string> = {
  probation: "Probation",
  permanent: "Permanent",
  resigned: "Resigned",
  terminated: "Terminated",
};

function Field({
  label,
  error,
  required,
  children,
  className,
}: {
  label: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label className="block text-xs font-medium text-muted-foreground">
        {label}
        {required && <span className="text-destructive ml-0.5">*</span>}
      </label>
      {children}
      {error && <p className="text-xs text-destructive mt-0.5">{error}</p>}
    </div>
  );
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export function ProfileClient({ user, initialProfile }: Props) {
  const [activeSection, setActiveSection] = useState<SectionId>("personal");
  const [phones, setPhones] = useState<string[]>(
    initialProfile?.phoneNumbers?.length ? initialProfile.phoneNumbers : [""],
  );
  const [bankBookUrl, setBankBookUrl] = useState<string>(
    initialProfile?.bankBookUrl ?? "",
  );
  const [uploading, setUploading] = useState(false);
  const [showPdpa, setShowPdpa] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sameAddress, setSameAddress] = useState(false);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      fullname: initialProfile?.fullname ?? "",
      icNumber: initialProfile?.icNumber ?? "",
      dateOfBirth: initialProfile?.dateOfBirth ?? "",
      gender: initialProfile?.gender ?? "",
      nationality: initialProfile?.nationality ?? "Malaysian",
      race: initialProfile?.race ?? "",
      maritalStatus: initialProfile?.maritalStatus ?? "",
      mailingAddress: initialProfile?.mailingAddress ?? "",
      permanentAddress: initialProfile?.permanentAddress ?? "",
      personalEmail: initialProfile?.personalEmail ?? "",
      emergencyName1: initialProfile?.emergencyName1 ?? "",
      emergencyRelationship1: initialProfile?.emergencyRelationship1 ?? "",
      emergencyPhone1: initialProfile?.emergencyPhone1 ?? "",
      emergencyAddress1: initialProfile?.emergencyAddress1 ?? "",
      emergencyName2: initialProfile?.emergencyName2 ?? "",
      emergencyRelationship2: initialProfile?.emergencyRelationship2 ?? "",
      emergencyPhone2: initialProfile?.emergencyPhone2 ?? "",
      emergencyAddress2: initialProfile?.emergencyAddress2 ?? "",
      // Statutory
      taxNo: initialProfile?.taxNo ?? "",
      epfNo: initialProfile?.epfNo ?? "",
      socsoNo: initialProfile?.socsoNo ?? "",
      // Bank
      bankName: initialProfile?.bankName ?? "",
      bankAccountNo: initialProfile?.bankAccountNo ?? "",
      bankAccountHolder: initialProfile?.bankAccountHolder ?? "",
      // Employment
      jobTitle: initialProfile?.jobTitle ?? "",
      department: initialProfile?.department ?? "",
      employmentType: initialProfile?.employmentType ?? "",
      employmentStatus: initialProfile?.employmentStatus ?? "",
      // Education
      educationLevel: initialProfile?.educationLevel ?? "",
      fieldOfStudy: initialProfile?.fieldOfStudy ?? "",
      // PDPA
      pdpaConsent: initialProfile?.pdpaConsent ?? false,
    },
  });

  const pdpaConsent = watch("pdpaConsent");
  const mailingAddress = watch("mailingAddress");

  const Sel = ({
    name,
    placeholder,
    options,
  }: {
    name: keyof FormValues;
    placeholder: string;
    options: { value: string; label: string }[];
  }) => (
    <Select
      onValueChange={(v) => setValue(name, v)}
      defaultValue={watch(name) as string}
    >
      <SelectTrigger className="h-9 text-sm">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  const getSectionCompletion = (id: SectionId): boolean => {
    const p = initialProfile;
    if (!p) return false;
    switch (id) {
      case "personal":
        return !!(p.fullname && p.icNumber && p.dateOfBirth);
      case "contact":
        return !!(p.mailingAddress && p.personalEmail);
      case "emergency":
        return !!(p.emergencyName1 && p.emergencyPhone1);
      case "employment":
        return !!(p.jobTitle && p.department);
      case "education":
        return !!p.educationLevel;
      case "banking":
        return !!(p.bankAccountNo && p.bankAccountHolder && p.bankName);
    }
  };

  const onSubmit = async (data: FormValues) => {
    setSaving(true);
    try {
      // employmentStatus is HR-only (see Leave Balances page) — never
      // submitted from this self-service form, regardless of form state.
      const { employmentStatus: _employmentStatus, ...rest } = data;
      await upsertProfile({
        ...rest,
        phoneNumbers: phones.filter(Boolean),
        bankBookUrl: bankBookUrl || undefined,
        pdpaConsentAt: data.pdpaConsent ? new Date() : undefined,
      });
      toast.success("Profile saved successfully");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleBankBookUpload = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const url = await uploadBankBook(fd);
      setBankBookUrl(url);
      toast.success("File uploaded successfully");
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setUploading(false);
    }
  };

  const currentIndex = SECTIONS.findIndex((s) => s.id === activeSection);
  const displayName = initialProfile?.fullname || user.name || "—";
  const jobTitle = initialProfile?.jobTitle || "—";
  const department = initialProfile?.department || "—";

  const renderSection = () => {
    switch (activeSection) {
      // ── Personal ──────────────────────────────────────────────────────
      case "personal":
        return (
          <div className="grid grid-cols-2 gap-4">
            <Field label="Full name (as per IC)" className="col-span-2">
              <Input
                {...register("fullname")}
                placeholder="e.g. Ahmad bin Abdullah"
                className="h-9 text-sm"
              />
            </Field>
            <Field label="IC number / passport">
              <Input
                {...register("icNumber")}
                placeholder="e.g. 900101-14-1234"
                className="h-9 text-sm font-mono"
              />
            </Field>
            <Field label="Date of birth">
              <Input
                type="date"
                {...register("dateOfBirth")}
                className="h-9 text-sm"
              />
            </Field>
            <Field label="Gender">
              <Sel
                name="gender"
                placeholder="Select"
                options={[
                  { value: "male", label: "Male" },
                  { value: "female", label: "Female" },
                ]}
              />
            </Field>
            <Field label="Marital status">
              <Sel
                name="maritalStatus"
                placeholder="Select"
                options={[
                  { value: "single", label: "Single" },
                  { value: "married", label: "Married" },
                  { value: "divorced", label: "Divorced" },
                  { value: "widowed", label: "Widowed" },
                ]}
              />
            </Field>
            <Field label="Nationality">
              <Input {...register("nationality")} className="h-9 text-sm" />
            </Field>
            <Field label="Race">
              <Sel
                name="race"
                placeholder="Select"
                options={[
                  { value: "malay", label: "Melayu" },
                  { value: "chinese", label: "Cina" },
                  { value: "indian", label: "India" },
                  { value: "iban", label: "Iban" },
                  { value: "kadazan", label: "Kadazan" },
                  { value: "other_bumiputera", label: "Bumiputera lain" },
                  { value: "other", label: "Lain-lain / Other" },
                ]}
              />
            </Field>
          </div>
        );

      // ── Contact ───────────────────────────────────────────────────────
      case "contact":
        return (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 mb-1">
                <div className="w-1 h-3.5 rounded-full bg-primary" />
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Mailing address
                </span>
              </div>
              <Textarea
                {...register("mailingAddress")}
                placeholder="Full mailing address"
                rows={3}
                className="text-sm resize-none"
              />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <div className="w-1 h-3.5 rounded-full bg-primary/40" />
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Permanent address
                  </span>
                </div>
                <label className="flex items-center gap-1.5 cursor-pointer select-none">
                  <Checkbox
                    checked={sameAddress}
                    onCheckedChange={(v) => {
                      setSameAddress(v as boolean);
                      if (v) setValue("permanentAddress", mailingAddress ?? "");
                    }}
                  />
                  <span className="text-xs text-muted-foreground">
                    Same as mailing
                  </span>
                </label>
              </div>
              <Textarea
                {...register("permanentAddress")}
                placeholder="Full permanent address"
                rows={3}
                className="text-sm resize-none"
                disabled={sameAddress}
              />
            </div>
            <Field label="Personal email" error={errors.personalEmail?.message}>
              <Input
                type="email"
                {...register("personalEmail")}
                placeholder="personal@email.com"
                className="h-9 text-sm"
              />
            </Field>
            <div className="space-y-2">
              <label className="block text-xs font-medium text-muted-foreground">
                Phone numbers
              </label>
              {phones.map((phone, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <div className="flex-1 relative">
                    <Input
                      value={phone}
                      onChange={(e) => {
                        const next = [...phones];
                        next[i] = e.target.value;
                        setPhones(next);
                      }}
                      placeholder={
                        i === 0 ? "+60 — Primary" : "+60 — Additional"
                      }
                      className="h-9 text-sm pr-16"
                    />
                    {i === 0 && (
                      <Badge
                        variant="secondary"
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] h-4 px-1.5"
                      >
                        Primary
                      </Badge>
                    )}
                  </div>
                  {phones.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9 text-muted-foreground hover:text-destructive shrink-0"
                      onClick={() =>
                        setPhones(phones.filter((_, idx) => idx !== i))
                      }
                    >
                      <XIcon className="w-3.5 h-3.5" />
                    </Button>
                  )}
                </div>
              ))}
              {phones.length < 4 && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs gap-1.5"
                  onClick={() => setPhones([...phones, ""])}
                >
                  <PlusIcon className="w-3 h-3" /> Add number
                </Button>
              )}
            </div>
          </div>
        );

      // ── Emergency ─────────────────────────────────────────────────────
      case "emergency":
        return (
          <div className="space-y-4">
            {[1, 2].map((n) => (
              <div
                key={n}
                className="border border-border rounded-lg p-4 space-y-3"
              >
                <div className="flex items-center gap-2.5">
                  <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                    <span className="text-xs font-semibold text-primary">
                      {n}
                    </span>
                  </div>
                  <span className="text-sm font-medium">
                    Emergency contact {n}
                  </span>
                  {n === 1 && (
                    <Badge
                      variant="outline"
                      className="text-[10px] h-4 px-1.5 ml-auto"
                    >
                      Primary
                    </Badge>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Full name">
                    <Input
                      {...register(`emergencyName${n}` as any)}
                      placeholder="Full name"
                      className="h-9 text-sm"
                    />
                  </Field>
                  <Field label="Relationship">
                    <Input
                      {...register(`emergencyRelationship${n}` as any)}
                      placeholder="e.g. Spouse, Parent"
                      className="h-9 text-sm"
                    />
                  </Field>
                  <Field label="Phone number">
                    <Input
                      {...register(`emergencyPhone${n}` as any)}
                      placeholder="+60"
                      className="h-9 text-sm"
                    />
                  </Field>
                  <Field label="Address">
                    <Input
                      {...register(`emergencyAddress${n}` as any)}
                      placeholder="Address"
                      className="h-9 text-sm"
                    />
                  </Field>
                </div>
              </div>
            ))}
          </div>
        );

      // ── Employment ────────────────────────────────────────────────────
      case "employment":
        return (
          <div className="grid grid-cols-2 gap-4">
            <Field label="Job position / title">
              <Input
                {...register("jobTitle")}
                placeholder="e.g. Software Engineer"
                className="h-9 text-sm"
              />
            </Field>
            <Field label="Department / unit">
              <Input
                {...register("department")}
                placeholder="e.g. Engineering"
                className="h-9 text-sm"
              />
            </Field>
            <Field label="Employment type">
              <Sel
                name="employmentType"
                placeholder="Select type"
                options={[
                  { value: "full-time", label: "Full-time" },
                  { value: "part-time", label: "Part-time" },
                  { value: "contract", label: "Contract" },
                  { value: "intern", label: "Internship" },
                ]}
              />
            </Field>
            <Field label="Employment status">
              <div className="h-9 flex items-center px-3 text-sm rounded-md border border-input bg-muted/40 text-muted-foreground">
                {EMPLOYMENT_STATUS_LABELS[initialProfile?.employmentStatus ?? ""] ?? "Not set"}
              </div>
              <p className="text-[11px] text-muted-foreground">Set by HR, not self-editable.</p>
            </Field>
          </div>
        );

      // ── Education ─────────────────────────────────────────────────────
      case "education":
        return (
          <div className="grid grid-cols-2 gap-4">
            <Field label="Highest education level">
              <Sel
                name="educationLevel"
                placeholder="Select level"
                options={[
                  { value: "phd", label: "PhD / Doctorate" },
                  { value: "master", label: "Master's degree" },
                  { value: "degree", label: "Bachelor's degree" },
                  { value: "diploma", label: "Diploma" },
                  { value: "sijil", label: "Sijil" },
                  { value: "spm", label: "SPM / O-Level" },
                  { value: "other", label: "Other" },
                ]}
              />
            </Field>
            <Field label="Field of study">
              <Input
                {...register("fieldOfStudy")}
                placeholder="e.g. Computer Science"
                className="h-9 text-sm"
              />
            </Field>
          </div>
        );

      // ── Banking ───────────────────────────────────────────────────────
      case "banking":
        return (
          <div className="space-y-5">
            {/* Security notice */}
            <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-200">
              <ShieldCheckIcon className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              This information is only accessible by authorised HR personnel.
            </div>

            {/* Statutory numbers */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-1 h-3.5 rounded-full bg-primary" />
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Statutory numbers
                </span>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <Field label="EPF / KWSP No.">
                  <Input
                    {...register("epfNo")}
                    placeholder="e.g. 10001234567"
                    className="h-9 text-sm font-mono"
                  />
                </Field>
                <Field label="SOCSO / PERKESO No.">
                  <Input
                    {...register("socsoNo")}
                    placeholder="e.g. 30-12345678-9"
                    className="h-9 text-sm font-mono"
                  />
                </Field>
                <Field label="Tax No. / TIN">
                  <Input
                    {...register("taxNo")}
                    placeholder="e.g. SG 12345678090"
                    className="h-9 text-sm font-mono"
                  />
                </Field>
              </div>
            </div>

            {/* Bank details */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-1 h-3.5 rounded-full bg-primary/40" />
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Bank details
                </span>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Bank name">
                  <Input
                    {...register("bankName")}
                    placeholder="e.g. Maybank, CIMB, Public Bank"
                    className="h-9 text-sm"
                  />
                </Field>
                <Field label="Bank account number">
                  <Input
                    {...register("bankAccountNo")}
                    placeholder="Account number"
                    className="h-9 text-sm font-mono"
                  />
                </Field>
                <Field label="Account holder name" className="col-span-2">
                  <Input
                    {...register("bankAccountHolder")}
                    placeholder="Full name as per bank records"
                    className="h-9 text-sm"
                  />
                </Field>
              </div>
            </div>

            {/* Bank book upload */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-1 h-3.5 rounded-full bg-primary/20" />
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Supporting document
                </span>
              </div>
              <div className="rounded-lg border-2 border-dashed border-border p-5 text-center hover:border-primary/40 hover:bg-muted/20 transition-colors">
                {bankBookUrl ? (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-center gap-2 text-green-600">
                      <CheckCircleIcon className="w-4 h-4" />
                      <span className="text-sm font-medium">File uploaded</span>
                    </div>
                    <a
                      href={bankBookUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-primary underline underline-offset-2 block"
                    >
                      View file
                    </a>
                    <label className="inline-flex items-center gap-1 text-xs text-muted-foreground cursor-pointer hover:text-foreground transition-colors">
                      <UploadIcon className="w-3 h-3" /> Replace
                      <input
                        type="file"
                        className="hidden"
                        accept="image/*,.pdf"
                        onChange={handleBankBookUpload}
                      />
                    </label>
                  </div>
                ) : (
                  <label className="cursor-pointer block">
                    <input
                      type="file"
                      className="hidden"
                      accept="image/*,.pdf"
                      onChange={handleBankBookUpload}
                    />
                    <div className="flex flex-col items-center gap-2 py-1">
                      <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center">
                        <UploadIcon className="w-4 h-4 text-muted-foreground" />
                      </div>
                      <span className="text-sm font-medium">
                        {uploading ? "Uploading…" : "Click to upload bank book"}
                      </span>
                      <p className="text-xs text-muted-foreground">
                        Image or PDF — max 5MB
                      </p>
                    </div>
                  </label>
                )}
              </div>
            </div>
          </div>
        );
    }
  };

  return (
    <div className="p-6">
      <PageHeader title="My Profile" description="Manage your personal information and bank details" />
      <form onSubmit={handleSubmit(onSubmit)}>
        <div className="bg-background border border-border rounded-xl overflow-hidden">
          {/* ── Avatar header ──────────────────────────────────────────── */}
          <div className="px-6 py-5 bg-muted/30 border-b border-border flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-base font-semibold text-primary shrink-0">
              {getInitials(displayName)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-sm text-foreground leading-tight">
                {displayName}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5 truncate">
                {jobTitle} · {department}
              </div>
            </div>
            {pdpaConsent && (
              <div className="flex items-center gap-1.5 text-xs font-medium text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-full px-3 py-1.5 shrink-0">
                <ShieldCheckIcon className="w-3.5 h-3.5" />
                PDPA agreed
              </div>
            )}
          </div>

          {/* ── Stepper ────────────────────────────────────────────────── */}
          <div className="px-6 py-4 border-b border-border bg-background overflow-x-auto">
            <div className="flex items-center min-w-max">
              {SECTIONS.map((s, i) => {
                const isActive = activeSection === s.id;
                const isDone = getSectionCompletion(s.id);
                const isPast = i < currentIndex;
                return (
                  <div key={s.id} className="flex items-center">
                    <button
                      type="button"
                      onClick={() => setActiveSection(s.id)}
                      className="flex items-center gap-2 group"
                    >
                      <div
                        className={cn(
                          "w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold border-2 transition-all shrink-0",
                          isActive
                            ? "bg-primary border-primary text-primary-foreground"
                            : isDone
                              ? "bg-green-500 border-green-500 text-white"
                              : isPast
                                ? "bg-muted border-border text-muted-foreground"
                                : "bg-background border-border text-muted-foreground group-hover:border-primary/40",
                        )}
                      >
                        {isDone && !isActive ? (
                          <CheckIcon className="w-3.5 h-3.5" />
                        ) : (
                          i + 1
                        )}
                      </div>
                      <span
                        className={cn(
                          "text-xs font-medium whitespace-nowrap",
                          isActive
                            ? "text-primary"
                            : isDone
                              ? "text-green-600 dark:text-green-400"
                              : "text-muted-foreground",
                        )}
                      >
                        {s.label}
                      </span>
                    </button>
                    {i < SECTIONS.length - 1 && (
                      <div
                        className={cn(
                          "h-px mx-3 transition-colors",
                          isDone ? "bg-green-400 w-8" : "bg-border w-8",
                        )}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── Section content ────────────────────────────────────────── */}
          <div className="p-6">{renderSection()}</div>

          {/* ── PDPA ───────────────────────────────────────────────────── */}
          <div className="px-6 pb-5">
            <div className="border border-border rounded-lg p-4 space-y-3">
              <div className="flex items-start gap-3">
                <Checkbox
                  id="pdpa"
                  checked={pdpaConsent}
                  onCheckedChange={(v) => setValue("pdpaConsent", v as boolean)}
                  className="mt-0.5"
                />
                <div className="flex-1 space-y-0.5">
                  <label
                    htmlFor="pdpa"
                    className="text-sm font-medium cursor-pointer select-none"
                  >
                    I agree to the Personal Data Protection Act (PDPA) 2010
                  </label>
                  <p className="text-xs text-muted-foreground">
                    Your data is collected for employment purposes only.{" "}
                    <button
                      type="button"
                      className="text-primary underline underline-offset-2 hover:opacity-80"
                      onClick={() => setShowPdpa(true)}
                    >
                      Read full PDPA notice
                    </button>
                  </p>
                  {errors.pdpaConsent && (
                    <p className="text-xs text-destructive">
                      {errors.pdpaConsent.message}
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* ── Footer nav ─────────────────────────────────────────────── */}
          <div className="px-6 py-4 border-t border-border bg-muted/20 flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <ShieldCheckIcon className="w-3.5 h-3.5" />
              Protected under PDPA 2010
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1 h-8 text-xs"
                disabled={currentIndex === 0}
                onClick={() => setActiveSection(SECTIONS[currentIndex - 1].id)}
              >
                <ChevronLeftIcon className="w-3.5 h-3.5" />
                {currentIndex > 0
                  ? SECTIONS[currentIndex - 1].label
                  : "Previous"}
              </Button>
              {currentIndex < SECTIONS.length - 1 ? (
                <Button
                  type="button"
                  size="sm"
                  className="gap-1 h-8 text-xs"
                  onClick={() =>
                    setActiveSection(SECTIONS[currentIndex + 1].id)
                  }
                >
                  {SECTIONS[currentIndex + 1].label}
                  <ChevronRightIcon className="w-3.5 h-3.5" />
                </Button>
              ) : (
                <Button
                  type="submit"
                  size="sm"
                  disabled={saving}
                  className="h-8 text-xs min-w-24 gap-1.5"
                >
                  {saving ? (
                    <>
                      <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                      Saving…
                    </>
                  ) : (
                    "Save profile"
                  )}
                </Button>
              )}
            </div>
          </div>
        </div>
      </form>

      {/* ── PDPA dialog ──────────────────────────────────────────────── */}
      <Dialog open={showPdpa} onOpenChange={setShowPdpa}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <ShieldCheckIcon className="w-5 h-5 text-primary" />
              Personal Data Protection Notice
            </DialogTitle>
          </DialogHeader>
          <div className="text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed max-h-72 overflow-y-auto border border-border rounded-lg p-4 bg-muted/20 font-mono">
            {PDPA_TEXT}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowPdpa(false)}>
              Close
            </Button>
            <Button
              onClick={() => {
                setValue("pdpaConsent", true);
                setShowPdpa(false);
                toast.success("PDPA consent recorded");
              }}
            >
              <ShieldCheckIcon className="w-4 h-4 mr-1.5" />I agree
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
