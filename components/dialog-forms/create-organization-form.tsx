"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";
import { createOrganization } from "@/server/organizations";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import * as z from "zod";

interface CreateOrganizationFormProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}

const formSchema = z.object({
  name: z.string().min(3, "Please enter organization name"),
  logo: z
    .instanceof(File)
    .refine((file) => file.type === "image/png", {
      message: "Only PNG files are allowed",
    })
    .refine((file) => file.size <= 500 * 1024, {
      message: "Max file size is 500KB",
    })
    .nullable()
    .optional(),
});

const CreateOrganizationForm = ({
  isOpen,
  onOpenChange,
}: CreateOrganizationFormProps) => {
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      logo: null,
    },
  });

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    // const slug = await lookupGenerateSlug(values.name);
    // const { data, error } = await authClient.organization.create({
    //   name: values.name,
    //   slug: "hello",
    // });
    const { success, message } = await createOrganization(
      values.name,
      values.logo,
    );
    if (success) {
      toast.success(message);
    } else {
      toast.error(message);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <DialogHeader className="mb-4">
            <DialogTitle>Create Organization</DialogTitle>
            <DialogDescription>
              Create a new organization to manage your workspace.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Controller
              name="name"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="name">Organization Name</FieldLabel>
                  <Input id="name" type="text" {...field} required />
                  {fieldState.invalid && (
                    <FieldError errors={[fieldState.error]} />
                  )}
                </Field>
              )}
            />

            <Controller
              name="logo"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="logo">
                    Organization Logo (PNG)
                  </FieldLabel>
                  <Input
                    id="logo"
                    type="file"
                    accept="image/png"
                    onChange={(e) => {
                      const file = e.target.files?.[0] || null;
                      field.onChange(file);
                    }}
                  />
                  {fieldState.invalid && (
                    <FieldError errors={[fieldState.error]} />
                  )}
                </Field>
              )}
            />
          </FieldGroup>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button type="submit">Create</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default CreateOrganizationForm;
