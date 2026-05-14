"use client";

import { authClient, useSession } from "@/lib/auth-client";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "../ui/card";
import * as z from "zod";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Field, FieldLabel } from "../ui/field";
import { Textarea } from "../ui/textarea";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { toast } from "sonner";
import { auth } from "@/lib/auth";

const emailSchema = z.string().email();

function splitEmails(input: string) {
  const emails = input.split(",").map((e) => e.trim());

  const valid: string[] = [];
  const invalid: string[] = [];

  for (const email of emails) {
    if (emailSchema.safeParse(email).success) {
      valid.push(email);
    } else {
      invalid.push(email);
    }
  }

  return { valid, invalid };
}

const formSchema = z.object({
  listOfEmail: z.string().min(3, "Please provide emails"),
});

const InviteMembersForm = () => {
  const { data } = useSession();
  const { data: activeOrganization } = authClient.useActiveOrganization();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      listOfEmail: "",
    },
  });

  //   const onSubmit = async (values: z.infer<typeof formSchema>) => {
  //     try {
  //       //   const emails = values.listOfEmail.split(",").map((e) => e.trim());
  //       //   const validEmails = emails.filter((email) =>
  //       //     /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),
  //       //   );
  //       //   const emailListSchema = z
  //       //     .string()
  //       //     .transform((val) => val.split(",").map((e) => e.trim()))
  //       //     .pipe(z.array(z.string().email()));
  //       //   const result = emailListSchema.safeParse(values.listOfEmail);
  //       const results = splitEmails(values.listOfEmail);
  //       if (results.invalid.length > 0) {
  //         toast.error(`${results.invalid.join(",")} not valid`);
  //       } else {
  //         try {
  //           await Promise.all(
  //             results.valid.map((email) =>
  //               authClient.organization.inviteMember({
  //                 email,
  //                 role: "member",
  //                 organizationId: activeOrganization?.id,
  //               }),
  //             ),
  //           );
  //         } catch (error) {
  //           console.error("FULL ERROR:", err);
  //           console.error("RESPONSE:", err?.response?._data);
  //         }
  //       }
  //     } catch (error: any) {
  //       console.error("FULL ERROR:", err);
  //       console.error("RESPONSE:", err?.response?._data);
  //     }
  //   };

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    try {
      const results = splitEmails(values.listOfEmail);

      if (results.invalid.length > 0) {
        toast.error(`${results.invalid.join(", ")} not valid`);
      }

      if (results.valid.length > 0) {
        const userEmail = results.valid[0];
        const { error } = await authClient.organization.inviteMember({
          email: userEmail,
          role: "member",
          organizationId: activeOrganization?.id,
        });

        console.log(error);
      }

      //   for (const email of results.valid) {
      //     try {
      //       await authClient.organization.inviteMember({
      //         email,
      //         role: "member",
      //         organizationId: activeOrganization?.id,
      //       });
      //     } catch (err: any) {
      //       console.error("Invite failed:", email);
      //       console.error("DETAIL:", err?.response?._data);
      //     }
      //   }
    } catch (error) {
      console.error(error);
    }
  };
  return (
    <div className="min-h-screen flex-1 rounded-xl bg-muted/50 md:min-h-min">
      <Card>
        <CardHeader>
          <CardTitle>
            Members Invitation for {activeOrganization?.name}
          </CardTitle>
          <CardDescription>
            Please Provide Members Email for Invitation Separated by Comma
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form id="invitation-form" onSubmit={form.handleSubmit(onSubmit)}>
            <Controller
              name="listOfEmail"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="listOfEmail">
                    Enter List of Emails Separated with Commas
                  </FieldLabel>
                  <Textarea id="listOfEmail" {...field} />
                </Field>
              )}
            />
          </form>
        </CardContent>
        <Field>
          <Button
            type="submit"
            disabled={form.formState.isSubmitting}
            form="invitation-form"
          >
            {form.formState.isSubmitting ? (
              <>
                <Spinner className="size-6" />
                Sending Invitation Email
              </>
            ) : (
              "Invite User"
            )}
          </Button>
        </Field>
        <CardFooter></CardFooter>
      </Card>
    </div>
  );
};

export default InviteMembersForm;
